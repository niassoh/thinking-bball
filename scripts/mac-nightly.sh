#!/bin/zsh
# The nightly's NBA.com half, which stats.nba.com won't serve to GitHub's runners: new
# games' play-by-play into git (the cloud run builds Footprint and Lonestar from it), the
# Last 30 Days windows' touches into git (Time of Poss % there), the season's playoff runs
# into git (the team card's trophies), and the season's tracking
# files into the bucket the stats sheet reads, the Teams sheet's team files too
# (team_tracking/, playtype/, opp_shooting/; docs/team-tracking.md). launchd runs it at 5 am
# (pbpstats has the night's games by ~3) and it then starts the cloud run itself (GitHub's
# own schedule is hours late or skipped, so it's only the fallback). At 7 am it runs again
# with --topup: NBA.com's drives, touches and defender distance can still be filling in at
# 5, so it pulls them again and starts a `scope=tracking` run (the sheet steps only) if
# they changed or the 5 am upload failed, or a full run if play-by-play the cloud hasn't seen
# turned up. scripts/mac-supervise.js retries whatever a run left stale. SITE_DATA is a
# site_Data clone (docs/daily-pipeline-requirements.md). A failed step posts a notification;
# the cloud run is started whatever failed before it.
cd "${0:A:h}/.." || exit 1
topup=; [[ $1 == --topup ]] && topup=1
# One at a time: after a sleep, launchd fires every missed job at once, and the supervisor
# may start this too; two copies would share the git index and the tracking files.
LOCK=/tmp/thinking-bball-nightly.lock
[[ -d $LOCK && -n $(find $LOCK -maxdepth 0 -mmin +120) ]] && rmdir $LOCK  # left by a killed run
mkdir $LOCK 2>/dev/null || { echo "== $(date): another mac-nightly.sh is running; exiting"; exit 0 }
trap 'rmdir $LOCK' EXIT
echo "== $(date)${topup:+ (top-up)}"
REPO=niassoh/thinking-bball
# A macOS notification, and a phone push when the launchd agent sets NTFY_TOPIC (https://ntfy.sh).
notify() {
  echo "ALERT: $1"
  osascript -e "display notification \"$1\" with title \"thinking-bball nightly\" sound name \"Basso\""
  [[ -n $NTFY_TOPIC ]] && curl -s -m 20 -H 'Title: thinking-bball nightly' -d "$1" "https://ntfy.sh/$NTFY_TOPIC" >/dev/null
  return 0
}
failed=()

# Just after 5 am the network can take a while to come back; every step needs it.
for i in {1..20}; do gh api -q .rate.remaining rate_limit >/dev/null 2>&1 && break; sleep 30; done

# The cloud run reads master: a clone left on another branch pushed nowhere it reads
# (2026-11-10). --autostash: edits left in the clone mustn't stop the pull.
git switch -q master || failed+=(on-master)
git pull -q --rebase --autostash || failed+=(pull)
node scripts/pbp-fetch.js || failed+=(play-by-play)
node scripts/touches-window.js || failed+=(touches)
node scripts/team-playoffs.js $(ls data/pbp | tail -1) || failed+=(team-playoffs)
git add data/pbp data/recent-touches.json data/team-playoffs.json
if ! git diff --cached --quiet; then
  git commit -q -m "Data: play-by-play and touches $(date -u +%F)${topup:+ (top-up)}" || failed+=(commit)
fi
# Against what GitHub has, not just this run's commit: one the 5 am push didn't get out still counts.
new_pbp=$(git diff --name-only @{u} -- data/pbp)
new_touches=$(git diff --name-only @{u} -- data/recent-touches.json)
if [[ -n $(git rev-list @{u}..HEAD) ]]; then
  # A cloud commit can land between the pull and the push: rebase onto it once.
  git push -q || { git pull -q --rebase --autostash && git push -q } || failed+=(push)
fi
season=$(ls data/pbp | tail -1)
end=$(( ${season:0:4} + 1 ))
out=data/sources/tracking-nightly
pulled() { find $out/$end data/sources/team-tracking -type f -exec md5 -q {} + 2>/dev/null | sort | md5 -q }
before=$(pulled)
# The files that did pull go up even when one didn't.
upload=ok
python3 scripts/playoff-tracking-pull.py "$SITE_DATA" $out $end $end --regular || upload=
node scripts/tracking-upload.js $end $out/$end || upload=
[[ -n $upload ]] || failed+=(tracking)
node scripts/team-tracking.js --from=$end --to=$end --refresh --upload || { upload=; failed+=(team-tracking) }
# The bucket may still hold yesterday's files even though the ones on disk are new: make the
# top-up redo the upload's sheet steps until an upload has gone through.
retracked=/tmp/thinking-bball-upload-failed
if [[ -n $upload ]]; then
  [[ -n $topup && -f $retracked ]] && uploaded_again=1
  rm -f $retracked
else
  touch $retracked
fi

# After the push and the upload: the cloud run reads both.
scope=all
if [[ -n $topup && -z $new_pbp ]]; then
  [[ -n $new_touches || -n $uploaded_again || $(pulled) != $before ]] && scope=tracking || scope=
fi
if [[ -n $scope ]]; then
  started=
  for i in 1 2 3; do gh workflow run nightly.yml -R $REPO -f scope=$scope && { started=1; break }; sleep 60; done
  [[ -n $started ]] && echo "started a scope=$scope cloud run" || failed+=(start-cloud-run)
else
  echo "top-up: nothing new since 5 am; no cloud run"
fi
(( $#failed )) && notify "Failed: ${(j:, :)failed}. See ~/Library/Logs/thinking-bball-nightly.log"
exit $(( $#failed > 0 ))
