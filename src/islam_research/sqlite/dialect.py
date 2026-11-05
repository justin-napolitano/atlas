"""Translate the application's parameterized query grammar into native SQLite.

The parser operates on SQL syntax, never interpolated parameter values. Unsupported
constructs fail rather than silently dropping constraints. PostgreSQL row locks
are explicitly replaced by the connection's SQLite writer transaction.
"""
from functools import lru_cache
import csv
import json
from importlib.resources import files

import sqlglot
from sqlglot import exp
from sqlglot.errors import ErrorLevel
from sqlglot.dialects.postgres import Postgres

SCHEMA = json.loads(files(__package__).joinpath('schema-v1.json').read_text())
TABLES = {t['name'] if t['schema']=='research' else 'public_'+t['name']:t for t in SCHEMA['tables']}
JSON_COLUMNS = {c['column_name'] for t in TABLES.values() for c in t['columns'] if c['data_type'] in {'jsonb','ARRAY'}}
BOOL_COLUMNS = {c['column_name'] for t in TABLES.values() for c in t['columns'] if c['data_type']=='boolean'}
TIME_COLUMNS = {c['column_name'] for t in TABLES.values() for c in t['columns'] if c['data_type']=='timestamp with time zone'}


def call(name, *args):
    return exp.Anonymous(this=name, expressions=list(args))


def table_name(schema, name):
    if schema not in {None,'','research','research_public'}:
        raise ValueError('Unknown SQLite namespace')
    return ('public_' if schema=='research_public' else '')+name


def json_column(node):
    if isinstance(node,exp.Paren):return json_column(node.this)
    if isinstance(node,exp.Anonymous) and node.name.lower() in {'json','json_object','json_array','atlas_to_json'}:return True
    return isinstance(node,exp.Column) and node.name in JSON_COLUMNS


def row_json(table, alias):
    values=[]
    for column in TABLES[table]['columns']:
        name=column['column_name'];value=exp.column(name,table=alias)
        if column['data_type'] in {'jsonb','ARRAY'}:
            value=call('json',value)
        elif column['data_type']=='boolean':
            value=call('json',exp.Case(ifs=[exp.If(this=exp.Is(this=value.copy(),expression=exp.Null()),true=exp.Null()),exp.If(this=value,true=exp.Literal.string('true'))],default=exp.Literal.string('false')))
        values.extend([exp.Literal.string(name),value])
    primary=next(c['definition'] for c in TABLES[table]['constraints'] if c['contype']=='p')
    names=[name.strip().strip('"') for name in primary[primary.index('(')+1:primary.index(')')].split(',')]
    absent=None
    for name in names:
        test=exp.Is(this=exp.column(name,table=alias),expression=exp.Null())
        absent=exp.And(this=absent,expression=test) if absent is not None else test
    return exp.Case(ifs=[exp.If(this=absent,true=exp.Null())],default=call('json_object',*values))


@lru_cache(maxsize=4096)
def translate(sql):
    tokens=Postgres.Tokenizer().tokenize(sql)
    pieces=[];position=0;index=0
    for left,right in zip(tokens,tokens[1:]):
        if left.token_type.name=='MOD' and left.text=='%' and right.text=='s' and left.end+1==right.start:
            pieces.extend([sql[position:left.start],':atlas_p'+str(index)])
            position=right.end+1;index+=1
    pieces.append(sql[position:]);sql=''.join(pieces)
    trees=sqlglot.parse(sql,read='postgres')
    if len(trees)!=1 or trees[0] is None:raise ValueError('One parameterized SQLite statement required')
    tree=trees[0]
    writer=bool(tree.find(exp.Lock)) or isinstance(tree,(exp.Insert,exp.Update,exp.Delete))
    aliases={table.alias_or_name:table_name(table.db,table.name) for table in tree.find_all(exp.Table) if not isinstance(table.this,exp.Func)}
    json_aliases={table.alias for table in tree.find_all(exp.Table) if isinstance(table.this,exp.Anonymous) and table.this.name.lower() in {'jsonb_array_elements','jsonb_each'} and table.alias}
    json_aliases.update(node.alias for node in tree.find_all(exp.Lateral) if isinstance(node.this,exp.Anonymous) and node.this.name.lower() in {'jsonb_array_elements','jsonb_each'})
    for select in tree.find_all(exp.Select):
        select.set('locks',None)

    def convert(node):
        nonlocal writer
        if isinstance(node,exp.Table):
            if isinstance(node.this,exp.Func):return node
            node.set('this',exp.to_identifier(table_name(node.db,node.name)))
            node.set('db',None);node.set('catalog',None)
        elif isinstance(node,exp.Union):
            first=node.this
            while isinstance(first,exp.Union):first=first.this
            if isinstance(first,exp.Select):
                first.set('expressions',[exp.alias_(value,value.name) if isinstance(value,exp.Column) else value for value in first.expressions])
        elif isinstance(node,exp.Lateral):
            if isinstance(node.this,exp.Anonymous) and node.this.name.lower()=='json_each':
                return exp.Table(this=node.this,alias=node.args.get('alias'))
            raise ValueError('SQLite requires an explicit correlated projection for this query')
        elif isinstance(node,exp.Ordered) and isinstance(node.parent,exp.OnConflict):
            node.set('nulls_first',not node.args.get('desc',False))
        elif isinstance(node,exp.Column) and node.db in {'research','research_public'}:
            node.set('table',exp.to_identifier(table_name(node.db,node.table)))
            node.set('db',None)
        elif isinstance(node,exp.Column) and not node.table and node.name in json_aliases:
            return exp.column('value',table=node.name)
        elif isinstance(node,exp.Dot) and isinstance(node.this,exp.Identifier) and node.this.name in {'research','research_public'} and isinstance(node.expression,exp.Func):
            return node.expression
        elif isinstance(node,exp.Cast):
            kind=node.to.this
            if kind in {exp.DataType.Type.JSON,exp.DataType.Type.JSONB}:
                return call('json',node.this)
            if kind==exp.DataType.Type.ARRAY:
                if isinstance(node.this,exp.Literal) and node.this.is_string and node.this.this.startswith('{'):
                    value=node.this.this[1:-1]
                    return exp.Literal.string(json.dumps(next(csv.reader([value])) if value else [],ensure_ascii=False))
                return node.this
            if kind in {exp.DataType.Type.TIMESTAMPTZ,exp.DataType.Type.UUID,exp.DataType.Type.NAME}:
                return exp.Cast(this=node.this,to=exp.DataType.build('TEXT'))
            if kind in {exp.DataType.Type.TEXT,exp.DataType.Type.VARCHAR} and json_column(node.this):
                return call('atlas_json_text',node.this)
        elif isinstance(node,exp.Array):
            return call('json_array',*node.expressions)
        elif isinstance(node,exp.Bracket):
            if len(node.expressions)!=1 or not isinstance(node.expressions[0],(exp.Column,exp.Literal)):
                raise ValueError('Unmapped SQLite array subscript')
            index=node.expressions[0]
            return call('atlas_array_at',node.this,index,exp.Literal.number(1 if isinstance(index,exp.Column) else 0))
        elif isinstance(node,(exp.EQ,exp.NEQ)):
            if isinstance(node.parent,(exp.Update,exp.OnConflict)) and node in node.parent.expressions:
                return node
            if isinstance(node.expression,exp.Any):
                value=node.expression.this
                if isinstance(value,exp.Paren):value=value.this
                if isinstance(value,exp.Anonymous) and value.name.lower()=='json_array':
                    test=exp.In(this=node.this,expressions=value.expressions)
                else:
                    query=exp.select('value').from_(exp.Table(this=call('json_each',value)))
                    test=exp.In(this=node.this,query=exp.Subquery(this=query))
                return exp.Not(this=test) if isinstance(node,exp.NEQ) else test
            if json_column(node.this) or json_column(node.expression):
                test=call('atlas_json_equal',node.this,node.expression)
                return exp.Not(this=test) if isinstance(node,exp.NEQ) else test
        elif isinstance(node,exp.ArrayContainsAll):
            return call('atlas_contains',node.this,node.expression)
        elif isinstance(node,exp.JSONBContainsAllTopKeys):
            return call('atlas_has_keys',node.this,node.expression)
        elif isinstance(node,exp.JSONBContainsTopKey):
            return call('atlas_has_key',node.this,node.expression)
        elif isinstance(node,exp.SHA2Digest):
            return call('atlas_sha256',node.this)
        elif isinstance(node,exp.Encode):
            return call('atlas_encode',node.this,node.args.get('charset') or node.expression)
        elif isinstance(node,exp.CurrentTimestamp):
            return call('atlas_now')
        elif isinstance(node,exp.Collate) and node.expression.name=='C':
            node.set('expression',exp.Var(this='BINARY'))
        elif isinstance(node,exp.AtTimeZone):
            if not isinstance(node.args.get('zone'),exp.Literal) or node.args['zone'].this!='UTC':raise ValueError('Only UTC timestamps are supported')
            return node.this
        elif isinstance(node,exp.TimeToStr):
            return call('atlas_time_text',node.this)
        elif isinstance(node,exp.MatchAgainst):
            if len(node.expressions)!=1:raise ValueError('One lexical search document required')
            return call('atlas_lexical_match',node.expressions[0],node.this)
        elif isinstance(node,exp.Greatest):
            return call('atlas_greatest',node.this,*node.expressions)
        elif isinstance(node,exp.Least):
            return call('atlas_least',node.this,*node.expressions)
        elif isinstance(node,exp.Anonymous):
            name=node.name.lower()
            if name=='to_jsonb':
                value=node.expressions[0]
                if isinstance(value,exp.Column) and not value.table and value.name in aliases:
                    return row_json(aliases[value.name],value.name)
                return call('atlas_to_json',value)
            if name=='clock_timestamp':return call('atlas_now')
            if name in {'to_tsvector','plainto_tsquery'}:return node.expressions[-1]
            if name=='jsonb_build_object':
                values=[call('json',value) if i%2 and json_column(value) else value for i,value in enumerate(node.expressions)]
                return call('json_object',*values)
            if name=='jsonb_build_array':return call('json_array',*node.expressions)
            if name=='jsonb_array_length':return call('json_array_length',*node.expressions)
            if name in {'jsonb_array_elements','jsonb_each'}:return call('json_each',*node.expressions)
            if name=='jsonb_typeof':return call('atlas_json_type',*node.expressions)
            if name=='convert_to':return call('atlas_convert_to',*node.expressions)
            if name=='octet_length':return call('atlas_octet_length',*node.expressions)
            if name=='index_library_source':writer=True
        elif isinstance(node,exp.Insert) and isinstance(node.this,exp.Schema) and node.this.this.name in {'quran_reading_progress','workspace_quran_reading_progress'}:
            names=[column.name for column in node.this.expressions]
            if 'read_at' not in names and isinstance(node.expression,exp.Values):
                offset=names.index('is_read');node.this.append('expressions',exp.to_identifier('read_at'))
                for row in node.expression.expressions:
                    row.append('expressions',exp.Case(ifs=[exp.If(this=row.expressions[offset].copy(),true=call('atlas_now'))],default=exp.Null()))
                conflict=node.args.get('conflict')
                if conflict is not None:
                    read_at=exp.Case(ifs=[exp.If(this=exp.column('is_read',table='EXCLUDED'),true=call('coalesce',exp.column('read_at',table=node.this.this.name),call('atlas_now')))],default=exp.Null())
                    conflict.append('expressions',exp.EQ(this=exp.column('read_at'),expression=read_at))
        elif isinstance(node,exp.Insert) and isinstance(node.this,exp.Schema) and node.this.this.name=='vault_sync_pages':
            names=[column.name for column in node.this.expressions]
            if 'notebook_entry_id' not in names and isinstance(node.expression,exp.Values):
                offset=names.index('entry_id')
                node.this.append('expressions',exp.to_identifier('notebook_entry_id'))
                node.this.append('expressions',exp.to_identifier('annotation_id'))
                for row in node.expression.expressions:
                    key=row.expressions[offset]
                    for kind in ['notebook','annotation']:
                        row.append('expressions',exp.Case(ifs=[exp.If(this=exp.Like(this=key.copy(),expression=exp.Literal.string('urn:research:'+kind+':%')),true=key.copy())],default=exp.Null()))
        return node

    # Bottom-up conversion ensures a schema-qualified function and its children
    # are translated together, including nested JSON and array expressions.
    def bottom(node):
        for key,value in list(node.args.items()):
            if isinstance(value,exp.Expression):node.set(key,bottom(value))
            elif isinstance(value,list):node.set(key,[bottom(v) if isinstance(v,exp.Expression) else v for v in value])
        return convert(node)
    tree=bottom(tree)
    return tree.sql(dialect='sqlite',unsupported_level=ErrorLevel.RAISE),writer


def expression(sql):
    value,_=translate('SELECT '+sql)
    return value.removeprefix('SELECT ')
