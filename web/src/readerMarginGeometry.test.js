import test from 'node:test';
import assert from 'node:assert/strict';
import {marginWidth,selectionToolbarPosition} from './readerMarginGeometry.js';
test('notes geometry is bounded by both preference and available reading space',()=>{
 assert.equal(marginWidth(360,1200),360);assert.equal(marginWidth(700,1200),640);assert.equal(marginWidth(400,650),310);assert.equal(marginWidth(-1),220);assert.equal(marginWidth('bad'),360);
});
test('selection action stays near the phrase and inside small viewports',()=>{
 assert.deepEqual(selectionToolbarPosition({left:100,top:200,bottom:240},1440,900),{left:100,top:248,maxWidth:240});
 const edge=selectionToolbarPosition({left:380,top:810,bottom:840},390,844);assert.equal(edge.left,138);assert.equal(edge.top,754);assert.ok(edge.top+48<844);
 const tall=selectionToolbarPosition({left:-20,top:-200,bottom:1200},390,844);assert.equal(tall.top,12);assert.equal(tall.left,12);
 const words=selectionToolbarPosition({left:380,top:700,bottom:740},390,844,{width:340,height:260});assert.equal(words.maxWidth,340);assert.ok(words.left+340<=378);assert.ok(words.top+260<=832);
});
