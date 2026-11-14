#!/bin/bash
# mux_music.sh VIDEO.mp4 MUSIC.wav OUT.mp4 - puts the generated music under the video: normalised to about -16 LUFS (a bed, not a wall), 0.4 s fade in, 2 s fade out, AAC 192k; the picture is copied untouched
V=$1; M=$2; O=$3; D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$V")
ffmpeg -y -v error -i "$V" -i "$M" -filter_complex "[1:a]loudnorm=I=-16:TP=-1.5:LRA=7,afade=t=in:st=0:d=0.4,afade=t=out:st=$(python3 -c "print(round($D-2.2,2))"):d=2.2,atrim=0:$D[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart "$O"
