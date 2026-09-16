if ($args[0] -eq "build") {
    Push-Location ./wolffia-ui
    npm run build
    Pop-Location
}
uv run wolffia