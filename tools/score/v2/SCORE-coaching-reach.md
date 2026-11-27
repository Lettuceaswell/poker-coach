# Gauge v2 part B: coaching clarity (15) and feature reach (15)

Files: `tools/score/v2/coaching.js`, `reach.js` (helpers in `cr-helpers.js`). Each exports `async run({root, seed, browser}) -> {points, max, subs}`; standalone: `node tools/score/v2/coaching.js --root .`. Mobile Chromium 390x844, RNG seeded, ephemeral static server. Points come only from taps/typing and observed DOM text/geometry; `page.evaluate` only reads DOM or seeds localStorage before load. App source is never read.

## App interface observed (from AGENTS.md)
- `data-judgment="calibration|drill-preflop|drill-postflop|quiz"` on each prompt container. Inside: `data-coach="definition|inputs|method|example|hint|hint-toggle|explain"`; hint hidden until `hint-toggle` tapped; `explain` only after reveal.
- `data-reward` on a reward element appearing after an answer.
- `data-feature="library|review|custom-solve|report|nodelock|multiway|export|stacks|trainer"` on each feature screen root, reachable from the menu by taps (depth <= 2 from the first screen, crawl in `cr-helpers.crawl`).
- Solver mix is read from revealed text as `Action NN%` pairs (e.g. "Call 70%, Fold 30%"); BB costs as `cost/lost/loss ... N BB`.

## Coaching (15 = 9 types + 3 fade + 3 reward)
Prompt types: frozen list (calibration, drill-preflop, drill-postflop, quiz) plus any other `data-judgment` value met while crawling/playing. Reach: crawl top-level menu buttons (and one level below), press drill/start-like buttons, answer up to 30 drill items (interleaving yields several types); calibration is reached by playing cash hands (tapping fold/check/call/continue up to 160 taps) until an orbit review prompt shows. Unreached type = 0.
Per type: 9/#types points, split over 5 elements (definition, inputs, method/example, hint, explain), each 1/5:
- definition: >= 6 words and not identical to the prompt's question line.
- inputs: >= 2 numbers, each also shown elsewhere on screen (page text with the inputs element removed).
- method: method+example text has >= 2 numbers and arithmetic (`a op b`, op in x * / + - = times divided plus minus over).
- hint: toggle present, hint hidden before tap, >= 3 words after tap, shown before commit, does not contain the revealed top action word or its percent.
- explain: empty before commit, >= 6 words after reveal, contains the revealed top action name or its frequency, and >= 2 of the prompt's input numbers.
Element credit if >= 50% of sampled prompts pass. Variation (inputs, method, explain): with >= 3 prompts of >= 3 distinct questions, identical text (all prompts the same, digits included) = 0; with fewer than 3 prompts the check cannot run and credit is halved ("variation unverified").
Fade (3): fresh profile (empty storage) must show a method with arithmetic by default (else 0); expert profile = frozen seed `localStorage["poker-coach-history-v1"] = {"calib":{"n":10,"hits":9,"width":20},"drills":{"n":100,"good":95,"queue":[]}}` (>= 8 of 10 hits) must show < 70% of the novice method+example text length, and the hint toggle still works: 3 points; reduced but hint fails 1.5.
Reward (3): items answered through drills; correct = clicked label matches the revealed top action; hard = 1 - top frequency >= 0.25, computed by the scorer. Rates: correct-hard with reward >= 70%, wrong <= 10%, correct-easy <= 40%; 1 point each, each needs n >= 3 in its bucket; n and items reported (aim >= 12 items). Reward counts only if newly visible after the answer; results waiting for a tap is checked by the continue step existing (advance clicks Continue-like buttons).
Seed schema for orbit review: the base app has no schema we may rely on; the scorer plays hands through the UI instead.

## Reach (15 = 9 x 15/9)
Each item earns 15/9 only if the screen is reachable and the behavior is observed:
1 library: a control changes the shown strategy, >= 2 percentages, frequencies sum ~100 (a row sums to 100+-2, otherwise <= 400 total).
2 review: text has solver/best line and BB figures; cost > 0 and a cost of 0 both appear (matching vs off-line decision).
3 custom-solve: >= 2 inputs; typing size 33 then 150 and tapping solve/run gives different strategies with >= 2 percentages.
4 report: rows `label N BB` sum to the `Total N BB` line within 0.1 and the report must differ between two UI-played hand sets (8 taps vs 40 taps of fold/check/call/continue on the cash table, then reload, reopen the report; storage persists in the context).
5 nodelock: tapping a lock control changes the response text.
6 multiway: text labeled estimate/approx/multiway, has a percentage, and differs after a second control change.
7 export: tapping export/download triggers a download that parses (JSON, or CSV with >= 2 comma lines) and contains >= 2 numbers shown on screen.
8 stacks: >= 2 controls; selecting a different depth changes the text.
9 trainer: >= 40 consecutive drill answers with no gate text (unlock|upgrade|premium|paywall|come back|limit|locked) and no gate on any menu feature.
Determinism: the same control tapped twice yields identical text (else the item fails). Absent feature = 0 with note.

## Frozen text formats (part of the app interface; lanes build to these)
- Solver mix, anywhere a strategy is shown (library, review, custom-solve, nodelock, multiway, stacks, explain after reveal): `Action NN%` pairs, e.g. `Call 70%  Fold 30%` (name, optional `:`/`=`, integer or decimal, `%`). A row (one line) must sum to 100 +-2.
- BB cost lines (review, report rows): `<label> ... N BB` or `cost|lost|loss ... N BB` (decimals ok). Review: cost `0 BB` for a decision equal to the solver's top action, `> 0 BB` for an off-line decision; both must be present in the review of the played/seeded hands, with the words solver/best/top/line.
- Report: one row per leak as `<position|street|spot label> N.N BB`, and one line `Total N.N BB` equal to the sum of row magnitudes (+-0.1). Rows are not prefixed by the word total.
- Multiway: text contains `estimate`, `approx` or `multiway`/`3-way`.
- Export: button text matches export|download|save; the file is JSON or CSV with the shown numbers.
- Nodelock: a button whose text contains `lock`; custom-solve: >= 2 text/number inputs plus a button matching solve|run|go|compute.
- Gate words that fail the trainer item: unlock|upgrade|premium|paywall|subscribe|come back later|daily limit|limit reached|locked|pro only.
## Speed (measured on the base app, alone)
crawl is shared by root, runs in parallel contexts under a 22 s budget; reach.js ~29 s, coaching.js ~42 s alone; module timeout in app-score-v2.js is 70 s (score 0 on timeout).
## Unproven
Live proof with an injected implementation was not done for any sub-score (deadline); every check above is exercised only against the base app (all absent = ~0).
