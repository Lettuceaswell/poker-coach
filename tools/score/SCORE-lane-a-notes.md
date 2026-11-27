# Lane A notes (input for SCORE.md)
- Points: accuracy 30 = preflop 15 (7 spots, bands in fixtures/score-constants.json, falloff 8 pp) + postflop 15 (3 river + 2 turn, 3 pts each, fixed wall budget river 250 ms / turn 1200 ms incl. solver creation, log curve 0.003%..3% pot).
- Speed 15 = turn T1 (target 0.25% pot) + depth-limited flop F1 (target 3% pot), 7.5 each; pts = 7.5*clamp(0.5+log2(baseline/median)/4); baseline_ms 1520 / 3400 (measured alone on base commit); 4x faster = full marks; timeout = 0. Run 1 searches the iteration count to target (BR checks with the clock paused), runs 2-3 re-run that count; median of 3; last repeat re-verified with frozen BR.
- Rules 15 = tests 9 (passed/total, 8 LOG.md tools, exit code; sim also no HANG/CHIPS output, postflop-test no FAIL lines, mapcheck must print an exact share) + browser rule checks 6 (lane B rules.points/rules.max scaled to 6). Any failed test -> veto test-failure; any veto caps total at 40.
- Quick args: sim 300 hands, mapcheck 6 300, postflop-test --quick.
- Exploitability always from frozen-br.js (independent best response over the candidate's strategyTable/actionsAt/nodeInfo, frozen-eval7.js showdowns); on the base commit it matches solver.exploitability() to 4 decimals on all 6 fixture spots.
- Fixed ports used by LOG.md browser tools: 8765 (shoot), 8774 (coach-shots), 8776 (orbit-nav); lane B uses an ephemeral port.
