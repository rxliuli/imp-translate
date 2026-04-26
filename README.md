# Browser Extension Template

A modern browser extension development template built with React, Shadcn/ui, and WXT. Supports building cross-browser extensions compatible with Chrome, Edge, Firefox, and Safari (requires macOS).

## Getting Started

### Initialize Project

```sh
git clone https://github.com/<your-github-username>/<your-project-name>.git
cd <your-project-name>
pnpm i
pnpm init-project
```

Follow the prompts to enter your project name and complete the initialization.

## Development

Chrome is used as the baseline version for development. Edge, Firefox, and Safari builds are only created when needed for publishing, testing, or debugging platform-specific issues.

### Start Development Server

```sh
pnpm dev
```

After running the development server:

1. Navigate to the `*.output/chrome-mv3-dev` directory to find the compiled extension files
2. Open `chrome://extensions` in Chrome
3. Enable "Developer mode"
4. Drag and drop the output directory to load the extension for debugging

## Build & Package

### Chrome, Edge, and Firefox

Generate production builds and create zip files for distribution:

```sh
pnpm zip && pnpm zip:firefox
```

### Safari

Safari extension requires macOS environment and Xcode for building and publishing.

#### Build Steps

1. Update `developmentTeam` in `wxt.config.ts` with your Apple Developer Team ID
2. Run `pnpm build:safari` - this will automatically build and open Xcode
3. Build the project in Xcode and test in Safari
4. To publish: In Xcode, select **Product → Archive** to submit to the App Store

## Requirements

- Node.js (latest LTS recommended)
- pnpm package manager
- macOS with Xcode (for Safari development only)
