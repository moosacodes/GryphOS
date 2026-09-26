# Grade engine

`src/engines/grades.ts` is pure math:

- weighted average on completed non-dropped work
- completed / remaining weight
- drop-lowest / best-N when categories exist
- required average on remaining work for a target
- required final exam score when final weight is known
- hypothetical what-if projection

Always distinguish official CourseLink displayed grades from gryphOS
calculations and hypotheticals.
