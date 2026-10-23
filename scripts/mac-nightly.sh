#!/bin/zsh
# The nightly's NBA.com half, which stats.nba.com won't serve to GitHub's runners: new
# games' play-by-play into git (the cloud run builds Footprint and Lonestar from it), the
# Last 30 Days windows' touches into git (Time of Poss % there), and the season's tracking
# files into the bucket the stats sheet reads. launchd runs it at 7 am, before the
# cloud run; SITE_DATA is a site_Data clone (docs/daily-pipeline-requirements.md).
cd "${0:A:h}/.." || exit 1
echo "== $(date)"
git pull -q --rebase || exit 1
failed=0
node scripts/pbp-fetch.js || failed=1
node scripts/touches-window.js || failed=1
git add data/pbp data/recent-touches.json
if ! git diff --cached --quiet; then
  git commit -q -m "Data: play-by-play and touches $(date -u +%F)" && git push -q || failed=1
fi
season=$(ls data/pbp | tail -1)
end=$(( ${season:0:4} + 1 ))
out=data/sources/tracking-nightly
python3 scripts/playoff-tracking-pull.py "$SITE_DATA" $out $end $end --regular && node scripts/tracking-upload.js $end $out/$end || failed=1
exit $failed
