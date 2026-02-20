# JSCAD Vibecoding App

AI-powered parametric 3D modeling with JSCAD. A Next.js + Convex + tRPC application that helps users "vibecode" (AI-assisted iterative coding) parametric 3D models.

## Features

- **AI-Powered Code Generation**: Natural language to JSCAD code via OpenRouter API
- **Live 3D Preview**: Real-time wireframe rendering with rotation/zoom
- **Parameter Sliders**: Auto-generated UI for model parameters
- **Version History**: Track changes with AI vs manual edits
- **Export**: STL/OBJ export for 3D printing
- **14 AI Tools**: `write_code`, `edit_code`, `read_code`, `get_diagnostics`, `check_intersection`, `measure_geometry`, `check_printability`, `list_variables`, `render_preview`, `set_parameters`, `ask_user`, `search_docs`, `diff_versions`, `split_components`

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS v4, Lucide React
- **Backend**: Convex (serverless database + functions)
- **API Layer**: tRPC with React Query
- **3D Library**: JSCAD v2 (@jscad/modeling)
- **Editor**: Monaco Editor (@monaco-editor/react)
- **AI**: OpenRouter API (supports multiple LLM providers)

## Project Structure

```
├── convex/                    # Convex backend
│   ├── schema.ts             # Database schema (5 tables)
│   ├── projects.ts           # Project CRUD operations
│   ├── versions.ts           # Version history
│   ├── chat.ts               # Chat messages
│   ├── templates.ts          # Starter templates
│   └── exports.ts            # Export tracking
├── src/
│   ├── app/                  # Next.js App Router
│   │   ├── page.tsx          # Dashboard
│   │   ├── layout.tsx        # Root layout with providers
│   │   └── project/[id]/     # Project editor
│   ├── components/           # React components
│   │   ├── chat-panel.tsx    # AI chat interface
│   │   ├── code-editor.tsx   # Monaco editor
│   │   ├── viewport-3d.tsx   # 3D wireframe renderer
│   │   ├── parameter-sliders.tsx
│   │   ├── version-history.tsx
│   │   ├── export-dialog.tsx
│   │   └── settings-dialog.tsx
│   ├── lib/                  # Utilities
│   │   ├── jscad-worker.ts   # Web Worker for code eval
│   │   ├── parameter-extractor.ts
│   │   ├── openrouter.ts     # API settings
│   │   ├── trpc-provider.tsx
│   │   └── convex-provider.tsx
│   ├── server/               # tRPC backend
│   │   ├── trpc.ts
│   │   └── routers/
│   │       ├── _app.ts
│   │       └── codegen.ts    # AI agent router (14 tools)
│   └── types/                # Type declarations
│       └── jscad.d.ts        # JSCAD module types
├── .env.local                # Environment variables
└── package.json
```

## Setup Instructions

### 1. Install Dependencies
```bash
cd /Users/heinrich/Documents/openmech
bun install
```

### 2. Set Up Convex (REQUIRED)

You need to initialize Convex to generate types and set up the backend:

```bash
npx convex dev --once --configure=new
```

This will:
- Create a Convex deployment
- Generate the `_generated` folder with TypeScript types
- Push the schema and functions to the cloud
- Set up the `NEXT_PUBLIC_CONVEX_URL` in `.env.local`

### 3. Configure OpenRouter (Optional)

1. Get an API key at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Open the app settings (gear icon) and paste your key
3. Or set it in `.env.local`:
   ```text
   OPENROUTER_API_KEY=your-key-here
   ```
4. To route requests through other OpenRouter endpoints (for example, Hack Club's proxy), also set:
   ```text
   NEXT_PUBLIC_OPENROUTER_BASE_URL=https://ai.hackclub.com
   ```
   See https://docs.ai.hackclub.com/<system-reminder> if you need to match their site requirements.

### 4. Configure Clerk (Authentication)

1. Create a Clerk account at https://clerk.com, add a new application, and note the publishable key + secret key.
2. Set the following values in `.env.local` (copy the placeholders already there):
   ```text
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk.clerk.your-publishable-key
   CLERK_SECRET_KEY=sk.clerk.your-secret-key
   ```
3. Restart the dev server so Clerk can read the new environment variables and protect every page.
4. When the middleware is active, unauthenticated visitors are redirected to `/sign-in`, where the Clerk `<SignIn>` component is rendered.

### 5. Run Development Server
```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 6. Seed Starter Templates (Optional)

After Convex is set up, you can seed the default templates:
```bash
npx convex run templates:seed
```

## Usage

1. **Authenticate**: Sign in at `/sign-in` (Clerk protects every route) before accessing the dashboard
2. **Create a Project**: Click "New Project" on the dashboard
3. **Chat with AI**: Describe what you want to build in natural language
4. **Edit Code**: The Monaco editor shows the JSCAD code - edit directly or via AI
5. **Adjust Parameters**: Use the sliders to tweak dimensions
6. **Save Versions**: Click "Save" to create version checkpoints
7. **Export**: Export as STL for 3D printing

## JSCAD Code Format

The app expects JSCAD v2 code that exports a `main()` function:

```javascript
const { cube, sphere } = require('@jscad/modeling').primitives
const { union } = require('@jscad/modeling').booleans

function main(params) {
  const { size = 10 } = params
  return union(
    cube({ size }),
    sphere({ radius: size / 2 })
  )
}

module.exports = { main }
```

Optional `getParameterDefinitions()` for parameter UI:

```javascript
function getParameterDefinitions() {
  return [
    { name: 'size', type: 'float', initial: 10, min: 1, max: 100, caption: 'Size:' }
  ]
}
```

## Known Issues

1. **Convex `_generated` folder missing**: Run `npx convex dev --once --configure=new`
2. **JSCAD in browser**: Uses Web Worker sandbox; some advanced features may need polyfills
3. **3D Rendering**: Currently uses Canvas 2D wireframe; WebGL renderer planned

## Scripts

- `bun run dev` - Start development server
- `bun run build` - Build for production
- `bun run start` - Start production server
- `npx convex dev` - Start Convex development mode

## License

MIT
