# SC-001 performance fixture

The benchmark creates 1,000 supported source files in a temporary snapshot root at test time. Keeping the fixture generated avoids committing 1,000 duplicate files while preserving a repeatable, isolated workload.
