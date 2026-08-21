
echo "=== 当前首页 ==="
curl -s --max-time 30 https://candelbot.app/ -o /tmp/cb3-home.html -w 'HTTP %{http_code} %{size_download}B time=%{time_total}s\n'
echo "client: $(grep -oE 'client-[A-Za-z0-9_.-]+\.js' /tmp/cb3-home.html | head -1)"
echo "=== 反复探测两个 chunk（10次）==="
for i in 1 2 3 4 5 6 7 8 9 10; do
  for f in page-loading-BlCbFRWZ.js play-button-BPItDbPH.js; do
    CT=$(curl -s --max-time 15 -o /dev/null -w '%{content_type}' "https://candelbot.app/_build/assets/$f")
    printf '%s=%s ' "$f" "$(echo "$CT" | cut -d';' -f1)"
  done
  echo "<- round $i"
done
echo "=== 部署的 sw.js 版本 ==="
curl -s --max-time 15 https://candelbot.app/sw.js -o /tmp/cb-sw.js -w 'HTTP %{http_code}\n'
grep -E 'VERSION|isCacheableAsset|dropBadCacheEntry' /tmp/cb-sw.js | head -5
