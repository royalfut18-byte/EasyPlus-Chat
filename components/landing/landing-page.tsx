'use client'

import { motion } from 'framer-motion'
import {
  ArrowRight,
  Boxes,
  Brain,
  Check,
  Code2,
  Crown,
  FileText,
  FolderKanban,
  Globe2,
  Lock,
  MessageSquare,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/brand/logo'
import { UI_MODELS } from '@/types/models'
import { WorkspacePreview } from './workspace-preview'

const features = [
  {
    icon: MessageSquare,
    title: 'AI Chat',
    description: 'Fast, clean conversations with premium model options for writing, reasoning, coding, and everyday work.',
  },
  {
    icon: FolderKanban,
    title: 'Projects',
    description: 'Dedicated workspaces with chats, files, instructions, and memory for long-running work.',
  },
  {
    icon: Upload,
    title: 'File Analysis',
    description: 'Upload PDFs, notes, screenshots, and documents, then ask questions or extract key information.',
  },
  {
    icon: Code2,
    title: 'Artifacts',
    description: 'Generate code, documents, previews, study notes, and downloadable work inside the workspace.',
  },
  {
    icon: Search,
    title: 'Search',
    description: 'Research current information when the task needs fresh context from the web.',
  },
  {
    icon: ShieldCheck,
    title: 'Admin Controls',
    description: 'Manage access, subscriptions, expiry dates, account status, and workspace users.',
  },
]

const useCases = [
  ['Students', 'Essays, study notes, exam prep, document summaries, and research support.'],
  ['Developers', 'Debugging, code generation, technical planning, and project context.'],
  ['Businesses', 'Client work, strategy, content, SEO, proposals, and company knowledge.'],
  ['Creators', 'Planning, writing, research, assets, scripts, and polished outputs.'],
  ['Admins and teams', 'Access controls, account expiry, subscriptions, and user management.'],
]

const trustPoints = [
  'Private user workspaces',
  'Project-scoped memory',
  'Admin and sub-admin management',
  'Account expiry and access controls',
  'Unlimited account support',
  'Clean workspace for files, chats, and outputs',
]

const landingModels = UI_MODELS.map((model) => ({
  id: model.id,
  name: model.name,
  color: model.color,
  badge:
    model.id === 'claude-opus-4.8'
      ? 'Max'
      : model.id === 'chat-gpt-5.5'
        ? 'Fast'
        : model.id === 'gemini-3.1-pro'
          ? 'Research'
          : model.id === 'deepseek-v4-pro'
            ? 'Coding'
            : 'Images',
}))

export function LandingPage() {
  return (
    <div className="min-h-screen overflow-hidden bg-[#050507] text-white">
      <Background />

      <header className="relative z-20 border-b border-white/[0.06] bg-[#050507]/70 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
          <Link href="/" aria-label="EasyPlus AI home">
            <Logo size="sm" showText />
          </Link>
          <div className="hidden items-center gap-7 text-sm text-gray-400 md:flex">
            <a href="#features" className="transition-colors hover:text-white">Features</a>
            <a href="#projects" className="transition-colors hover:text-white">Projects</a>
            <a href="#use-cases" className="transition-colors hover:text-white">Use cases</a>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" className="hidden text-gray-300 hover:bg-white/[0.06] hover:text-white sm:inline-flex">
                Sign in
              </Button>
            </Link>
            <Link href="/chat">
              <Button className="rounded-full bg-white px-4 text-sm font-semibold text-black hover:bg-gray-200 md:px-5">
                Get started
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </nav>
      </header>

      <main className="relative z-10">
        <section className="mx-auto max-w-7xl px-5 pb-16 pt-16 md:px-8 md:pb-24 md:pt-24">
          <div className="mx-auto max-w-4xl text-center">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-gray-300 shadow-2xl shadow-violet-950/20"
            >
              <Sparkles className="h-3.5 w-3.5 text-violet-300" />
              A premium AI workspace for serious work
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="text-balance text-5xl font-semibold tracking-[-0.055em] text-white sm:text-6xl md:text-7xl lg:text-8xl"
            >
              Your all-in-one
              <span className="block bg-gradient-to-r from-violet-200 via-white to-cyan-100 bg-clip-text text-transparent">
                AI workspace.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16 }}
              className="mx-auto mt-7 max-w-3xl text-pretty text-base leading-8 text-gray-400 md:text-xl"
            >
              Use powerful AI chat, upload files, build artifacts, search the web, and organize long-term work with Projects and memory.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24 }}
              className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
            >
              <Link href="/chat">
                <Button size="lg" className="h-12 rounded-full bg-violet-500 px-7 font-semibold text-white shadow-lg shadow-violet-950/40 hover:bg-violet-400">
                  Start chatting
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="h-12 rounded-full border-white/[0.12] bg-white/[0.03] px-7 text-gray-200 hover:bg-white/[0.08] hover:text-white">
                  Sign in
                </Button>
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.34 }}
              className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-gray-500"
            >
              {['Chat', 'Files', 'Projects', 'Memory', 'Artifacts', 'Search'].map((item) => (
                <span key={item} className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-violet-300" />
                  {item}
                </span>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="mx-auto mt-8 max-w-4xl rounded-[1.75rem] border border-white/[0.08] bg-white/[0.03] p-4 text-left shadow-2xl shadow-black/20"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Model lineup</p>
                  <p className="mt-2 text-sm text-gray-400">
                    Switch between premium models for coding, writing, research, reasoning, and image generation inside one workspace.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {landingModels.map((model) => (
                    <div
                      key={model.id}
                      className="rounded-full border border-white/[0.08] bg-black/20 px-3 py-1.5 text-xs text-gray-200"
                    >
                      <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: model.color }} />
                      <span>{model.name}</span>
                      <span className="ml-2 text-gray-500">{model.badge}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>

          <WorkspacePreview />
        </section>

        <section id="features" className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
          <SectionHeader
            eyebrow="Workspace capabilities"
            title="Everything you need to think, create, and ship with AI."
            description="A clean workspace for conversations, files, projects, research, and polished outputs."
          />
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, index) => (
              <FeatureCard key={feature.title} {...feature} delay={index * 0.05} />
            ))}
          </div>
        </section>

        <section id="projects" className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
          <div className="grid items-center gap-10 lg:grid-cols-[0.95fr_1.05fr]">
            <SectionHeader
              align="left"
              eyebrow="Project memory"
              title="Projects that remember."
              description="Create long-term workspaces for school, clients, coding, business, and research. Each project keeps its own chats, files, instructions, and memory so the AI understands the work over time."
            />
            <ProjectMemoryCard />
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
          <div className="grid gap-5 lg:grid-cols-2">
            <ShowcaseCard
              icon={<FileText className="h-5 w-5" />}
              title="Upload and understand documents."
              description="Upload documents, notes, PDFs, screenshots, and images. Ask questions, summarize, rewrite, compare, or extract key information."
            >
              <DocumentVisual />
            </ShowcaseCard>
            <ShowcaseCard
              icon={<Boxes className="h-5 w-5" />}
              title="Create useful outputs directly inside the workspace."
              description="Generate code, study notes, documents, web components, previews, and downloadable files without leaving the chat."
            >
              <ArtifactVisual />
            </ShowcaseCard>
          </div>
        </section>

        <section id="use-cases" className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
          <SectionHeader
            eyebrow="Built for real workflows"
            title="From study sessions to client work."
            description="EasyPlus AI adapts to the work you are doing, not the other way around."
          />
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {useCases.map(([title, description]) => (
              <div key={title} className="rounded-3xl border border-white/[0.08] bg-white/[0.03] p-5 transition-colors hover:border-violet-300/20 hover:bg-white/[0.05]">
                <h3 className="font-semibold text-white">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-gray-500">{description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
          <div className="rounded-[2rem] border border-white/[0.08] bg-[#101014]/80 p-6 shadow-2xl shadow-black/30 md:p-10">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-violet-300/20 bg-violet-500/10 text-violet-200">
                  <Lock className="h-5 w-5" />
                </div>
                <h2 className="mt-6 text-3xl font-semibold tracking-tight md:text-5xl">A serious workspace for serious AI users.</h2>
                <p className="mt-5 max-w-xl text-base leading-7 text-gray-400">
                  Clean workspaces, private account access, project-scoped memory, and admin controls help teams and power users stay organized.
                </p>
                <Link href="/chat">
                  <Button className="mt-8 rounded-full bg-white px-6 font-semibold text-black hover:bg-gray-200">
                    Get started
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {trustPoints.map((point) => (
                  <div key={point} className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] px-4 py-3 text-sm text-gray-300">
                    <Check className="h-4 w-4 shrink-0 text-violet-300" />
                    {point}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-20 text-center md:px-8 md:py-28">
          <div className="rounded-[2rem] border border-violet-300/15 bg-gradient-to-b from-violet-500/10 to-white/[0.03] p-8 shadow-2xl shadow-violet-950/20 md:p-14">
            <Crown className="mx-auto h-8 w-8 text-violet-200" />
            <h2 className="mt-6 text-4xl font-semibold tracking-tight md:text-6xl">Start building with AI today.</h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-gray-400 md:text-lg">
              Open the workspace and bring your chats, files, projects, research, and generated outputs into one focused place.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/chat">
                <Button size="lg" className="h-12 rounded-full bg-violet-500 px-7 font-semibold text-white hover:bg-violet-400">
                  Start chatting
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="h-12 rounded-full border-white/[0.12] bg-white/[0.03] px-7 text-gray-200 hover:bg-white/[0.08] hover:text-white">
                  Sign in
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.06] bg-[#050507]/80">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-8 md:flex-row md:items-center md:justify-between md:px-8">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <div>
              <p className="text-sm font-medium text-gray-200">EasyPlus AI</p>
              <p className="text-xs text-gray-600">Copyright 2026. All rights reserved.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-gray-500">
            <Link href="/login" className="transition-colors hover:text-white">Login</Link>
            <Link href="/chat" className="transition-colors hover:text-white">Chat</Link>
            <Link href="/projects" className="transition-colors hover:text-white">Projects</Link>
            <Link href="/billing" className="transition-colors hover:text-white">Billing</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function Background() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(139,92,246,0.24),transparent_34%),radial-gradient(circle_at_15%_25%,rgba(34,211,238,0.10),transparent_28%),linear-gradient(180deg,#050507_0%,#08080d_45%,#050507_100%)]" />
      <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(circle_at_center,black,transparent_72%)]" />
      <div className="absolute left-1/2 top-0 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-violet-500/10 blur-3xl" />
    </div>
  )
}

function SectionHeader({
  eyebrow,
  title,
  description,
  align = 'center',
}: {
  eyebrow: string
  title: string
  description: string
  align?: 'left' | 'center'
}) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-2xl'}>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-300">{eyebrow}</p>
      <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-5xl">{title}</h2>
      <p className="mt-5 text-base leading-7 text-gray-400 md:text-lg">{description}</p>
    </div>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  delay,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ delay, duration: 0.45 }}
      className="group rounded-3xl border border-white/[0.08] bg-white/[0.03] p-6 transition-all hover:-translate-y-1 hover:border-violet-300/20 hover:bg-white/[0.05]"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-violet-200 transition-colors group-hover:border-violet-300/20 group-hover:bg-violet-500/10">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-6 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-gray-500">{description}</p>
    </motion.div>
  )
}

function ProjectMemoryCard() {
  return (
    <div className="rounded-[2rem] border border-white/[0.08] bg-[#101014]/90 p-5 shadow-2xl shadow-black/30 md:p-6">
      <div className="rounded-3xl border border-white/[0.07] bg-white/[0.035] p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-200">
              <FolderKanban className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Project</p>
              <h3 className="font-semibold text-white">HSC Economics</h3>
            </div>
          </div>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">Active</span>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <MiniPanel title="Memory" icon={<Brain className="h-4 w-4" />}>
            <p>Uses Band 6 structure</p>
            <p>Australian examples</p>
            <p>Teacher prefers clear judgement</p>
          </MiniPanel>
          <MiniPanel title="Files" icon={<FileText className="h-4 w-4" />}>
            <p>stimulus.pdf</p>
            <p>essay-plan.docx</p>
            <p>inflation-data.png</p>
          </MiniPanel>
          <MiniPanel title="Recent chats" icon={<MessageSquare className="h-4 w-4" />}>
            <p>Fiscal policy essay</p>
            <p>Inflation notes</p>
            <p>Budget evaluation</p>
          </MiniPanel>
        </div>
      </div>
    </div>
  )
}

function MiniPanel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-200">
        <span className="text-violet-300">{icon}</span>
        {title}
      </div>
      <div className="space-y-2 text-xs leading-5 text-gray-500">{children}</div>
    </div>
  )
}

function ShowcaseCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-[2rem] border border-white/[0.08] bg-white/[0.03]">
      <div className="p-6 md:p-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-violet-200">
          {icon}
        </div>
        <h2 className="mt-6 text-2xl font-semibold tracking-tight text-white md:text-3xl">{title}</h2>
        <p className="mt-4 text-sm leading-7 text-gray-400 md:text-base">{description}</p>
      </div>
      {children}
    </div>
  )
}

function DocumentVisual() {
  return (
    <div className="border-t border-white/[0.07] bg-black/20 p-6">
      <div className="rounded-3xl border border-white/[0.08] bg-[#111115] p-4">
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-violet-300/25 bg-violet-500/5 p-4">
          <FileText className="h-8 w-8 text-violet-200" />
          <div>
            <p className="text-sm font-medium text-white">macroeconomics-notes.pdf</p>
            <p className="text-xs text-gray-500">Analysing document...</p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl bg-white/[0.04] p-4 text-sm leading-6 text-gray-300">
          <p className="font-medium text-white">AI summary</p>
          <p className="mt-2 text-gray-500">Key themes: inflation pressure, fiscal policy response, household spending, and evaluation points for essay structure.</p>
        </div>
      </div>
    </div>
  )
}

function ArtifactVisual() {
  return (
    <div className="border-t border-white/[0.07] bg-black/20 p-6">
      <div className="rounded-3xl border border-white/[0.08] bg-[#111115] p-4">
        <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
          <div className="flex rounded-full border border-white/[0.08] bg-white/[0.03] p-1 text-xs">
            <span className="rounded-full bg-violet-500 px-3 py-1 text-white">Preview</span>
            <span className="px-3 py-1 text-gray-500">Code</span>
          </div>
          <button className="rounded-full border border-white/[0.08] px-3 py-1 text-xs text-gray-300">Copy</button>
        </div>
        <div className="mt-4 rounded-2xl bg-gradient-to-br from-violet-500/20 via-white/[0.06] to-cyan-500/10 p-5">
          <div className="rounded-2xl border border-white/[0.10] bg-black/30 p-4">
            <p className="text-sm font-semibold text-white">Generated study dashboard</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="h-16 rounded-xl bg-white/[0.10]" />
              <div className="h-16 rounded-xl bg-violet-400/20" />
              <div className="h-16 rounded-xl bg-cyan-400/15" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
