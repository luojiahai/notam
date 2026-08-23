/** Written verbatim by `notam init`. Every key that has a default is shown commented out. */
export const CONFIG_TEMPLATE = `# NOTAM configuration — ~/.notam/config.yaml
#
# Tokens are NEVER stored here. Each host names the environment variable that
# supplies its token; export that variable in your shell profile.

hosts:
  - id: github
    # label: GitHub.com          # optional, defaults to the id
    api_base: https://api.github.com
    graphql: https://api.github.com/graphql
    token_env: NOTAM_GITHUB_TOKEN

  # A GitHub Enterprise Server instance, if you have one:
  # - id: ghe
  #   api_base: https://ghe.example.net/api/v3
  #   graphql: https://ghe.example.net/api/graphql
  #   token_env: NOTAM_GHE_TOKEN

repos:
  - host: github
    name: owner/repo
    # path_globs restrict sync to the folders your team owns. Omit or leave
    # empty to sync every merged PR in the repository.
    path_globs: []
    # default_branch: main       # base branch for promotion PRs
    # window_days: 180           # how far back the first backfill reaches
    # prompt_template: ~/.notam/prompts/owner-repo.md

analysis:
  concurrency: 3
  timeout_seconds: 120
  # model:                       # omitted — uses the claude CLI's own default

server:
  port: 4317
`;
