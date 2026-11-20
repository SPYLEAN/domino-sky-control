# 90-second demo script

Figures below are what the deterministic engine produces for the default scenario (Mumbai 08:00–09:30, "Protect passengers"). Re-run the app to verify them; nothing is hard-coded.

**0:00 — Hook (intro overlay).**
"One airport closes. One aircraft arrives late. Its next flight can't leave. That's the domino effect — and every line on this screen comes from the live simulation."

**0:10 — Create the storm.**
"Mumbai closes from 08:00 to 09:30. I press *Simulate Disruption*. Nine flights are delayed across seven airports, 1,425 passengers sit on late flights, 435 flight-delay minutes, and two connection groups — 48 people — miss their onward flights."

**0:25 — Watch the dominoes.**
Press Play on the timeline. "Delhi–Mumbai DS0201 can't land in the closure, so instead of circling it's held on the ground in Delhi. DS0501 can't leave Mumbai until 09:30 — and the same aircraft carries that lateness to Bengaluru, then Kochi on DS0502. Cities that never closed inherit the delay."

**0:40 — Understand why.**
Click DS0502 → Reasoning Lens. "Plain English first. *Why* walks the ledger back to the root: the Mumbai closure. *Show the proof* gives the exact formula: previous arrival plus thirty minutes turnaround." Mention CX09: 44 passengers in Kochi still connect — with five minutes to spare instead of forty.

**0:55 — Recover.**
Open Recovery. "The dispatcher considered 255 options, ruled out 190 physically impossible ones — a spare in Bengaluru can't fly from Mumbai — and fully simulated 65. Its pick under *protect passengers*: hold DS0702 and DS0903 so both connection groups make it."

**1:10 — See the difference.**
Apply plan. "Missed-connection passengers go from 48 to zero. The cost — 15,630 extra passenger-minutes of delay — is shown, not hidden. Switch the objective to *Reduce total delay* and the trade-off flips: it would cancel six flights — 911 booked boardings — to save 40,900 passenger-minutes. Same engine, different values, every consequence on screen."

**1:20 — The Domino Story & close.**
Open Domino Story. "Seven scenes, every sentence generated from the event ledger. AI may polish wording, but it can never touch a number. Domino Sky: predict the ripple, break the chain."
