gh api repos/Jont828/dynamo/commits/418a77b --jq '.commit.message, "", (.files[] | "\(.filename)  +\(.additions) -\(.deletions)")'
