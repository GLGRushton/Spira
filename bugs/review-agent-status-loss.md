# Review agent status loss and silent waiting

## Summary

Twice now, a task reached the final review stage and the requested review agents did not produce usable results. The background review agents disappeared from the runtime, and Shinra did not clearly surface that failure quickly enough, leaving the user waiting without a reliable signal about whether work was still in progress.

## What happened

1. Implementation work completed and local validation passed.
2. A Sonnet review was launched in background mode.
3. The review agent either vanished from the runtime or was cleared before returning findings.
4. A retry was launched and also disappeared.
5. Shinra continued to frame the task as "waiting on review" instead of promptly reporting that no active review agent remained.

## Expected behavior

- If a background review agent disappears, fails, or cannot be read back, that should be reported immediately.
- The user should get a clear state update: **running**, **completed**, **failed**, **missing**, or **relaunching**.
- Review steps near the end of a task should not leave the user in an indefinite wait state without explicit progress or failure reporting.

## Actual behavior

- Review agents were not present when inspected later.
- No review findings were returned.
- Status messaging implied continued progress when the review process had effectively been lost.
- The user had to ask what was happening.

## Impact

- End-of-task confidence drops because requested reviews are not reliably delivered.
- The user loses time waiting for a result that is no longer in flight.
- Trust is damaged both by the runtime failure and by weak escalation/reporting from Shinra.

## Likely failure modes

- Background agent sessions are being cleared or dropped by the runtime before results are read.
- The agent lifecycle is not durable enough for long-running end-of-task reviews.
- Shinra did not treat "agent not found" as a terminal problem requiring immediate escalation to the user.

## Recommended fixes

1. Treat **agent not found** after launch as a hard failure, not as an implicit "still working" state.
2. For final review steps, prefer **synchronous/blocking review execution** over background mode unless there is a strong reason not to.
3. Add a timeout/escalation rule: if a review agent does not return within a reasonable window, explicitly tell the user the review is stalled and what recovery action is being taken.
4. Surface a short progress note whenever the task is effectively paused on external review infrastructure.
5. If a retry is launched, state that the previous review was lost and that a fresh attempt has begun.

## Immediate process change

Until background review reliability is understood, final Sonnet/Opus review passes should be run in a mode that cannot silently disappear without an explicit failure signal.
