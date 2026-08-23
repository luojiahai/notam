#!/bin/sh
# A stand-in for the claude CLI. Consumes the piped payload, ignores every
# flag, and prints one valid --output-format json envelope. The directive it
# emits differs per invocation so the two entries produce two distinct rules
# and the promotion commits two files.
cat > /dev/null
N=$(cat "${NOTAM_FAKE_CLAUDE_COUNTER}" 2>/dev/null || echo 0)
N=$((N + 1))
echo "$N" > "${NOTAM_FAKE_CLAUDE_COUNTER}"
printf '{"result":"```json\\n[{\\"kind\\":\\"do\\",\\"directive\\":\\"Always add a regression test number %s.\\",\\"rationale\\":\\"Reviewers blocked untested fixes.\\",\\"scope_globs\\":[\\"services/payments/**\\"],\\"confidence\\":0.9,\\"source_comment_urls\\":[]}]\\n```"}\n' "$N"
