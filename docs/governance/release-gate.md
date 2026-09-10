# WhispeRM Release Gate

This policy binds release eligibility to executable evidence for one exact source identity.

## Required aggregate validation

The canonical pull request gate is the GitHub Actions job named `validate` in `.github/workflows/ci.yml`. It must report failure unless all of the following stages succeed on the same head commit:

- migration safety
- lint
- bootstrap
- normal typecheck
- strict typecheck
- workspace tests
- doctor tests
- production build
- C31 evidence-manifest generation

A skipped, cancelled, missing, or failed mandatory stage is not success.

## Review and branch enforcement

The `main` branch must require a pull request, the canonical `validate` result, at least one current approval, and resolution of material review conversations. Relevant head changes stale prior approvals and evidence. Force pushes and branch deletion must remain disabled. Emergency bypass must be restricted to named principals, reasoned, time-bounded, incident-linked, and independently reviewed.

These settings require repository-administrator evidence. This file does not prove that the settings are active.

## Artifact pairing and promotion

Web and API artifacts form one release candidate only when both are immutable and trace to the same merged source commit, lockfile, workflow identity, and compatible configuration revision. Production promotion must reject a candidate whose canonical validation did not pass for that identical source.

Provider deployment success is operational evidence, not constitutional release evidence.

## Recipient safety

Automated tests must stub communication providers. Any path that could contact a recipient outside the declared test allowlist invalidates the attempt and triggers containment before further provider testing.

## Successor closure

A release decision must include:

1. full source, tree, workflow, lockfile, run, job, artifact, deployment, and configuration identities;
2. the C31 manifest and independently recomputed digest;
3. closure or explicit retained-open state for A29-01 through A29-12;
4. repository and platform control evidence;
5. runtime observation opening and closing on the same release identity; and
6. rollback authority and a known-good compatible artifact pair.

Merge authorization and release authorization are separate decisions. C26 through C31 remain immutable predecessor evidence.
