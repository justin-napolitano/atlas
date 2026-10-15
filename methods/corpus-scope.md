# Corpus scope and expansion

Islam is the first working corpus. Philosophy and comparative religion supply adjacent, explicitly scoped inquiries when a text or question calls for them. The platform is not attempting comprehensive coverage of Islamic intellectual history or all religions at launch.

## First reading pilot

The question is how selected exegetes interpret *ulū al-amr* in Q 4:59. Begin with the sources and located records already in `graph/research.ttl`, summarized in `reports/pilot-ulul-amr-quran-4-59.md`:

| Source representation | Role | Current recorded limitation |
| --- | --- | --- |
| Quran.com, Saheeh International rendering of Q 4:59 | Named English translation display | An English rendering does not establish the Arabic text's full interpretive meaning |
| Al-Tabari, online commentary on Q 4:59 | Primary source for this commentator's interpretation | Online text/locator assertions do not settle print-edition or manuscript questions |
| Al-Tabataba'i, online English excerpt from *Al-Mizan* | Primary source for this author's interpretation in translation | Print-edition details and translation questions remain explicit |
| Mun'im Sirry, 2021 article on early exegesis | Modern historical scholarship | Metadata/abstract and selected scope were recorded; full section-level argument review remains outstanding |

These are existing research assertions, not a claim that this implementation pass reread the originals. The versioned manifest `research-plans/corpora/islam-authority-pilot.json` points to their stable IDs and existing locators. It does not duplicate source prose or authorize copying full text.

Q 4:83 is an extension prompted by the modern article's stated scope. Resolve and review its actual text/commentaries separately before publishing new findings. Keep the broader revelation/authority question in issue #3; do not silently widen the pilot to that whole question.

## Selection and coverage

This small comparison is chosen because it already has a question, identifiable source representations, attributed claims, and located evidence. It includes different interpretive positions and a historical study. It is not a representative sample of all Sunni, Shi'i, or other Muslim traditions, nor of later jurisprudence, philosophy, mysticism, or lived religion.

Record missing perspectives as gaps. Do not invent an additional source or an opposing view simply to balance a display. The starting workbook remains a seed bibliography, not a verified corpus. New metadata leads remain unreviewed until evaluated against the actual research question.

## Expansion rule

Add a source or bounded subcorpus when all of the following are recorded:

1. A specific question and what this source may contribute.
2. Author/attributed author, work and representation/edition, language, genre, period/place/tradition where supported, and known uncertainty.
3. Access/rights and a permitted acquisition/reference path; unknown rights do not authorize full-text publication.
4. Source-selection rationale, relevant counter-readings, coverage gaps, and review plan.
5. A useful reading/annotation path in the current platform, rather than a hypothetical generic feature.

Compare themes such as authority, revelation, being, and ethics across sources using explicit scoped links. Shared labels do not establish identical meanings, intellectual influence, or equivalent traditions.

## Maintenance

Update the corpus manifest and selection rationale when sources enter or leave scope. Preserve stable IDs and previous selection decisions. Human reading, bibliographic verification, scholarly claim review, and publication are different statuses. Follow `editorial-review.md` before promoting a candidate or publishing a substantive finding.
