import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    "intro",
    {
      type: "category",
      label: "Getting started",
      link: { type: "generated-index", slug: "/getting-started" },
      collapsed: false,
      items: [
        "getting-started/overview",
        "getting-started/local-development",
      ],
    },
    {
      type: "category",
      label: "Architecture",
      link: { type: "generated-index", slug: "/architecture" },
      collapsed: false,
      items: [
        "architecture/overview",
        "architecture/stack",
        "architecture/protocols",
      ],
    },
    {
      type: "category",
      label: "Operators",
      link: { type: "generated-index", slug: "/operators" },
      items: [
        "operators/deployment",
        "operators/observability",
        "operators/backups",
      ],
    },
    {
      type: "category",
      label: "Contributors",
      link: { type: "generated-index", slug: "/contributors" },
      items: [
        "contributors/development-setup",
        "contributors/coding-standards",
        "contributors/rfc-process",
      ],
    },
    {
      type: "category",
      label: "Compliance",
      link: { type: "generated-index", slug: "/compliance" },
      items: [
        "compliance/overview",
        "compliance/audit-logging",
        "compliance/data-handling",
      ],
    },
    {
      type: "category",
      label: "Architecture decisions",
      link: { type: "doc", id: "adr/README" },
      items: [
        "adr/record-architecture-decisions",
        "adr/monorepo-layout",
        "adr/connect-rpc-over-plain-grpc",
        "adr/versioned-migrations-ent-atlas",
        "adr/markdown-for-message-body",
        "adr/connect-streaming-for-realtime",
        "adr/event-broker-from-day-one",
        "adr/handler-level-authorization",
      ],
    },
  ],
};

export default sidebars;
