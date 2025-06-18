#! /bin/bash
# mp4-to-hls.sh - makes an HLS stream out of the given mp4 file, 3 renditions and 5-sec segments
# Transcodes the input to 30fps and 5-sec keyframe interval. This might impact the quality of the video, but this is just for test fixtures

readonly input_file=$1
readonly output_dir=$2

mkdir output

ffmpeg -i "$input_file" \
  -filter_complex "\
  [0:v]split=3[v1][v2][v3]; \
  [v1]scale=w=-2:h=1080,fps=30[v1out]; \
  [v2]scale=w=-2:h=720,fps=30[v2out]; \
  [v3]scale=w=-2:h=480,fps=30[v3out]" \
  -map "[v1out]" -map a:0  -c:v:0 libx264 -x264-params "keyint=150:scenecut=0" -b:v:0 5000k -maxrate:v:0 5350k -bufsize:v:0 7500k -c:a:0 aac -b:a:0 192k \
  -map "[v2out]" -map a:0 -c:v:1 libx264 -x264-params "keyint=150:scenecut=0" -b:v:1 2800k -maxrate:v:1 2996k -bufsize:v:1 4200k -c:a:1 aac -b:a:1 128k \
  -map "[v3out]" -map a:0 -c:v:2 libx264 -x264-params  "keyint=150:scenecut=0" -b:v:2 1400k -maxrate:v:2 1498k -bufsize:v:2 2100k -c:a:2 aac -b:a:2 96k \
  -f hls -hls_time 5 -hls_playlist_type vod \
  -hls_segment_filename "$output_dir/stream_%v/%d.ts" \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" \
  "$output_dir/stream_%v/media.m3u8"
