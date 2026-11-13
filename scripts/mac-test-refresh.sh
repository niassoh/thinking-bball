#!/bin/zsh
# The test site's daily data (https://niassoh.github.io/tbball-test/): brings master's nightly
# data into this branch and redeploys the test site from it, once a day. launchd
# (com.thinkingbball.test) runs it at 11 am Pacific: the nightly lands by 7-8 am and the
# Mac's last retry (scripts/mac-supervise.js, 10 am) is done by then; a Mac asleep at 11 runs
# it on waking. It doesn't run the nightly itself: a second run would read the stats and
# team sheets and NBA.com twice a day. The data cache merges key by key
# (scripts/merge-cache.js: master's season being played, this branch's backfilled past
# seasons); the audit log keeps both sides' rows. Any other conflict stops it, with an alert.
set -u
cd "${0:A:h}/.."
SITE_REF=team-units
BRANCH=claude-copy-backfill
TMP=$(mktemp -d)
trap 'rm -rf $TMP' EXIT
# Git's own credential manager can wait on a login window no one sees; gh's token never does.
export GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0=
export GIT_CONFIG_KEY_1=credential.helper GIT_CONFIG_VALUE_1='!gh auth git-credential'

print "== $(date) (test refresh)"
fail() {
  print "FAILED: $1"
  osascript -e "display notification \"$1\" with title \"thinking-bball test\" sound name \"Basso\""
  [[ -n "${NTFY_TOPIC:-}" ]] && curl -s -m 20 -H 'Title: thinking-bball test' -d "$1" "https://ntfy.sh/$NTFY_TOPIC" > /dev/null
  exit 1
}

[[ "$(git branch --show-current)" == $BRANCH ]] || fail "test refresh: $PWD isn't on $BRANCH"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail "test refresh: $BRANCH has uncommitted changes, skipped"
git fetch -q origin || fail "test refresh: fetch failed"
git merge -q --ff-only origin/$BRANCH || fail "test refresh: $BRANCH and origin's have diverged"
if git merge-base --is-ancestor origin/master HEAD && [[ -z "$(git log origin/$BRANCH..HEAD)" ]]; then
  print "nothing new"
  exit 0
fi

if ! git merge-base --is-ancestor origin/master HEAD; then
  msg="Merge master: the nightly data through $(git log -1 --format=%cs origin/master)"
  if ! git merge -q --no-edit -m "$msg" origin/master; then
    for f in ${(f)"$(git diff --name-only --diff-filter=U)"}; do
      git show :1:$f > $TMP/base && git show :2:$f > $TMP/ours && git show :3:$f > $TMP/theirs || { git merge --abort; fail "test refresh: can't read $f's sides" }
      case $f in
        data/cached-data.json) node scripts/merge-cache.js $TMP/base $TMP/ours $TMP/theirs || { git merge --abort; fail "test refresh: the data cache conflicts (see the log)" } ;;
        docs/data-pull-audit.md) git merge-file --union $TMP/ours $TMP/base $TMP/theirs ;;
        *) git merge --abort; fail "test refresh: merge conflict in $f" ;;
      esac
      cp $TMP/ours $f && git add $f
    done
    git commit -q --no-edit || fail "test refresh: the merge didn't commit"
  fi
  print "$msg"
fi

git push -q origin HEAD:$BRANCH || fail "test refresh: push failed"
gh workflow run deploy.yml -R niassoh/tbball-test -f site_ref=$SITE_REF -f backend_ref=$BRANCH || fail "test refresh: the deploy didn't start"
print "test deploy started ($SITE_REF + $BRANCH)"
