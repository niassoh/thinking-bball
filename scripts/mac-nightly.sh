#!/bin/zsh
# The nightly's NBA.com half, which stats.nba.com won't serve to GitHub's runners: new
# games' play-by-play into git (the cloud run builds Footprint and Lonestar from it), the
# Last 30 Days windows' touches into git (Time of Poss % there), and the season's tracking
# files into the bucket the stats sheet reads. launchd runs it at 7 am; it then starts the
# cloud run itself (GitHub's own schedule is hours late or skipped, so it's only the
# fallback). SITE_DATA is a site_Data clone (docs/daily-pipeline-requirements.md).
# A failed step, or no cloud run finishing in 26 hours, posts a macOS notification.
cd "${0:A:h}/.." || exit 1
echo "== $(date)"
REPO=niassoh/thinking-bball
notify() {
  echo "ALERT: $1"
  osascript -e "display notification \"$1\" with title \"thinking-bball nightly\" sound name \"Basso\""
}
failed=()

# A cloud run that never started (or never finished) says nothing on its own.
last=$(gh run list -R $REPO -w nightly.yml --json createdAt,conclusion -q '[.[] | select(.conclusion != "" and .conclusion != "cancelled")][0].createdAt')
if [[ -z $last ]] || (( $(date +%s) - $(TZ=UTC date -j -f %Y-%m-%dT%H:%M:%SZ "$last" +%s) > 26 * 3600 )); then
  notify "No cloud nightly has finished since ${last:-ever}: the site's data is stale."
fi

git pull -q --rebase || { notify "git pull failed; nothing ran."; exit 1 }
node scripts/pbp-fetch.js || failed+=(play-by-play)
node scripts/touches-window.js || failed+=(touches)
git add data/pbp data/recent-touches.json
if ! git diff --cached --quiet; then
  git commit -q -m "Data: play-by-play and touches $(date -u +%F)" && git push -q || failed+=(push)
fi
season=$(ls data/pbp | tail -1)
end=$(( ${season:0:4} + 1 ))
out=data/sources/tracking-nightly
# The files that did pull go up even when one didn't.
tracking=ok
python3 scripts/playoff-tracking-pull.py "$SITE_DATA" $out $end $end --regular || tracking=
node scripts/tracking-upload.js $end $out/$end || tracking=
[[ -n $tracking ]] || failed+=(tracking)
# After the push and the upload: the cloud run reads both.
gh workflow run nightly.yml -R $REPO || failed+=(start-cloud-run)
(( $#failed )) && notify "Failed: ${(j:, :)failed}. See ~/Library/Logs/thinking-bball-nightly.log"
exit $(( $#failed > 0 ))
