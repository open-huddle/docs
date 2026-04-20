import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const organizationName = "open-huddle";
const projectName = "docs";
const repoUrl = `https://github.com/${organizationName}/huddle`;
const docsRepoUrl = `https://github.com/${organizationName}/${projectName}`;

const config: Config = {
  title: "Open Huddle",
  tagline: "Self-hostable team collaboration — messaging, channels, voice and video.",
  favicon: "img/favicon.ico",

  future: {
    v4: true,
    faster: true,
  },

  // Production URL. GitHub Pages serves project sites at
  // https://<org>.github.io/<repo>/, so baseUrl matches the repo name.
  // When a custom domain (CNAME) is configured, flip url + baseUrl accordingly.
  url: `https://${organizationName}.github.io`,
  baseUrl: `/${projectName}/`,

  organizationName,
  projectName,
  deploymentBranch: "gh-pages",
  trailingSlash: false,

  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "throw",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  headTags: [
    {
      tagName: "link",
      attributes: {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
    },
    {
      tagName: "link",
      attributes: {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossorigin: "anonymous",
      },
    },
    {
      tagName: "link",
      attributes: {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    },
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          // Serve docs at the site root (baseUrl) so URLs stay
          // /docs/intro rather than /docs/docs/intro on GitHub Pages.
          routeBasePath: "/",
          editUrl: `${docsRepoUrl}/edit/main/`,
          // Enable these after the first commit lands — they require git history.
          showLastUpdateAuthor: false,
          showLastUpdateTime: false,
          breadcrumbs: true,
          // Versioning: the "current" version is development / unreleased.
          // Run `pnpm docs:version <version>` when we tag a release — that version
          // becomes the new lastVersion and current rolls forward as "next".
          includeCurrentVersion: true,
          lastVersion: "current",
          versions: {
            current: {
              label: "Next",
              banner: "unreleased",
              badge: true,
            },
          },
        },
        blog: {
          showReadingTime: true,
          blogTitle: "Open Huddle blog",
          blogDescription: "Release notes, architecture posts, and project news.",
          postsPerPage: 10,
          feedOptions: {
            type: ["rss", "atom"],
            title: "Open Huddle blog",
            description: "Release notes, architecture posts, and project news.",
            copyright: `Copyright © ${new Date().getFullYear()} Open Huddle Contributors.`,
            xslt: true,
          },
          editUrl: `${docsRepoUrl}/edit/main/`,
          onInlineTags: "warn",
          onInlineAuthors: "warn",
          onUntruncatedBlogPosts: "warn",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
        sitemap: {
          changefreq: "weekly",
          priority: 0.5,
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/social-card.png",
    metadata: [
      { name: "keywords", content: "open huddle, teams, slack, self-hosted, foss, soc2, hipaa, kubernetes, messaging, video" },
      { name: "og:type", content: "website" },
    ],
    colorMode: {
      defaultMode: "light",
      respectPrefersColorScheme: true,
      disableSwitch: false,
    },
    announcementBar: {
      id: "pre_alpha",
      content:
        'Open Huddle is <strong>pre-alpha</strong> and under active construction. Interfaces and schemas may change without notice.',
      backgroundColor: "#1e3a8a",
      textColor: "#ffffff",
      isCloseable: false,
    },
    navbar: {
      title: "Open Huddle",
      logo: {
        alt: "Open Huddle",
        src: "img/logo.svg",
        srcDark: "img/logo-dark.svg",
      },
      hideOnScroll: false,
      items: [
        {
          type: "docSidebar",
          sidebarId: "docs",
          position: "left",
          label: "Docs",
        },
        {
          to: "/blog",
          label: "Blog",
          position: "left",
        },
        {
          type: "docsVersionDropdown",
          position: "right",
          dropdownActiveClassDisabled: true,
        },
        {
          href: repoUrl,
          position: "right",
          className: "header-github-link",
          "aria-label": "GitHub repository",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Product",
          items: [
            { label: "Introduction", to: "/docs/intro" },
            { label: "Getting started", to: "/docs/getting-started/overview" },
            { label: "Architecture", to: "/docs/architecture/overview" },
          ],
        },
        {
          title: "Operate",
          items: [
            { label: "Deployment", to: "/docs/operators/deployment" },
            { label: "Compliance", to: "/docs/compliance/overview" },
            { label: "Security policy", href: `${repoUrl}/blob/main/SECURITY.md` },
          ],
        },
        {
          title: "Community",
          items: [
            { label: "Contributing", to: "/docs/contributors/development-setup" },
            { label: "Governance", href: `${repoUrl}/blob/main/GOVERNANCE.md` },
            { label: "Code of Conduct", href: `${repoUrl}/blob/main/CODE_OF_CONDUCT.md` },
            { label: "Discussions", href: `${repoUrl}/discussions` },
          ],
        },
        {
          title: "Project",
          items: [
            { label: "Blog", to: "/blog" },
            { label: "Source (huddle)", href: repoUrl },
            { label: "Source (docs)", href: docsRepoUrl },
            { label: "License", href: `${repoUrl}/blob/main/LICENSE` },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Open Huddle Contributors. Licensed under Apache 2.0. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ["bash", "diff", "json", "yaml", "toml", "go", "protobuf", "docker", "nginx"],
    },
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: true,
      },
    },
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 4,
    },
    // Algolia DocSearch placeholder — request keys once the site is public.
    // algolia: {
    //   appId: "XXXXXXXXXX",
    //   apiKey: "YYYYYYYYYY",
    //   indexName: "open-huddle",
    //   contextualSearch: true,
    // },
  } satisfies Preset.ThemeConfig,
};

export default config;
