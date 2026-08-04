# Contributing

The canonical repository is on GitLab at [gitlab.com/polycode-projects/the-mechanical-code-talker](https://gitlab.com/polycode-projects/the-mechanical-code-talker).

Please open merge requests there. The GitHub repository is a read-only mirror synced hourly.

## Development setup

Install dependencies:

```bash
npm ci
```

Run tests while you iterate. The test-rung table in [CLAUDE.md](CLAUDE.md) explains which tests run at each stage. During development:

```bash
npm run test:fast
```

Before you open a merge request:

```bash
npm test
```

## Writing style

This project follows the style rules in [.claude/skills/plain-prose/SKILL.md](.claude/skills/plain-prose/SKILL.md).

For code comments and documentation: use short sentences, active voice, and everyday words. Cut jargon or define it clearly on first use. Prefer specific examples to abstract descriptions.
