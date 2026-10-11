# Scoring and evaluation

LitRevolt’s understanding score is an evidence summary, not a claim to measure
all scientific expertise. It combines three progressively deeper closed-book
retrieval checks with two forms of written synthesis.

| Component | Maximum weighted points |
| --- | ---: |
| Pass 1 quiz | 15 |
| Pass 2 quiz | 20 |
| Pass 3 quiz | 25 |
| Summary evaluation | 20 |
| Critical-review evaluation | 20 |

Each quiz and writing evaluation receives a paper-grounded score from 0–100.
The contribution is `component score ÷ 100 × component weight`, rounded to one
decimal place. The five weighted contributions sum to a maximum of 100.

The increasing pass weights reflect increasing cognitive depth: surveying a
paper matters, but independently reconstructing and challenging it is stronger
evidence. Summary and critique are weighted equally to reward both accurate
synthesis and critical independence.

Missing components contribute zero and set `complete = false`. LitRevolt always
shows the breakdown so a reader can distinguish an incomplete review from weak
performance. The exact submissions, rubric rows, citations, and feedback remain
stored with the review for auditability.

Model-based evaluation is fallible. Citations make feedback inspectable, but the
reader remains responsible for checking the cited page and contesting an
unreasonable judgment by revising or rerunning the evaluation.
