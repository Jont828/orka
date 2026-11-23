git show --stat --format='%h %s%n%n%b' orka-demo/base-next | head -n 8; git diff orka-demo/base orka-demo/base-next -- deploy/utils/README.md | tail -n 6
