# Legacy program fixture contract

The program runtime is not part of the current Papers product direction. It remains as
an opt-in engineering fixture for the historical sandbox, crash recovery, capability
broker and ACP experiments.

Normal builds never load bundled programs. Set `PAPERS_ENABLE_FIXTURES=1` to exercise
the fixture contract and its automated tests. Do not add new user-facing workflows to
this system unless the creator explicitly reverses the existing-product rule.

The complete historical contract remains available in Git history before the product
pivot recorded in `docs/DECISIONS.md`.
