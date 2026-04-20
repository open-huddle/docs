import type { ReactNode } from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import HomepageFeatures from "@site/src/components/HomepageFeatures";

import styles from "./index.module.css";

function Hero(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className={clsx("container", styles.heroInner)}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>Open source · Apache 2.0</span>
          <Heading as="h1" className={styles.heroTitle}>
            {siteConfig.title}
          </Heading>
          <p className={styles.heroTagline}>{siteConfig.tagline}</p>
          <p className={styles.heroLede}>
            An open-source alternative to proprietary collaboration suites, built
            for organizations that need to own their communication stack.
            Designed from day one for enterprise-scale self-hosted deployments
            with <strong>SOC 2</strong> and <strong>HIPAA</strong> as first-class
            concerns.
          </p>
          <div className={styles.heroActions}>
            <Link className="button button--primary button--lg" to="/docs/intro">
              Read the docs
            </Link>
            <Link
              className="button button--secondary button--lg"
              to="/docs/getting-started/overview"
            >
              Get started
            </Link>
            <Link
              className={clsx("button button--link button--lg", styles.heroGithub)}
              href="https://github.com/open-huddle/huddle"
            >
              View on GitHub →
            </Link>
          </div>
          <dl className={styles.heroStats}>
            <div>
              <dt>Target scale</dt>
              <dd>10,000 users</dd>
            </div>
            <div>
              <dt>Deployment</dt>
              <dd>Self-hosted only</dd>
            </div>
            <div>
              <dt>License</dt>
              <dd>Apache 2.0</dd>
            </div>
          </dl>
        </div>
        <aside className={styles.heroPanel} aria-hidden="true">
          <pre className={styles.codeSample}>
{`# Bring up the stack on Kubernetes
helm repo add open-huddle https://charts.open-huddle.org
helm install huddle open-huddle/huddle \\
  --namespace huddle --create-namespace \\
  --values values.prod.yaml

# Or run it locally
make dev-up && make api-run`}
          </pre>
        </aside>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="Self-hostable, open-source team collaboration platform — messaging, channels, voice, and video — designed for SOC 2 and HIPAA environments at 10,000-user scale."
    >
      <Hero />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
