if [ "$1" == "build" ]; then
    cd ./wolffia-ui && npm run build && cd -
fi
uv run wolffia