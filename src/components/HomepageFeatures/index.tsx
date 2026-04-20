import type { ReactNode } from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import Heading from "@theme/Heading";
import styles from "./styles.module.css";

type FeatureItem = {
  title: string;
  description: ReactNode;
  icon: ReactNode;
  href?: string;
};

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const features: FeatureItem[] = [
  {
    title: "Own your data",
    href: "/docs/architecture/overview",
    icon: <Icon d="M4 7v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3zM9 12l2 2 4-4" />,
    description:
      "Single-tenant by design. Your messages, channels, and recordings live in your infrastructure — never ours.",
  },
  {
    title: "Compliance by architecture",
    href: "/docs/compliance/overview",
    icon: <Icon d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3z" />,
    description:
      "Event-sourced audit trail, automatic mTLS between services, encryption in transit and at rest — built in, not bolted on.",
  },
  {
    title: "Enterprise scale",
    href: "/docs/architecture/stack",
    icon: <Icon d="M3 17l6-6 4 4 8-8M14 7h7v7" />,
    description:
      "Every architectural choice assumes a 10,000-user deployment. Kubernetes-first, horizontally scalable, battle-tested components only.",
  },
  {
    title: "100% FOSS",
    href: "/docs/architecture/stack",
    icon: <Icon d="M12 2v20M2 12h20" />,
    description:
      "Every dependency is OSI-approved. No SSPL, no BSL, no surprise relicenses. Fork it, ship it, sell support for it.",
  },
  {
    title: "Open standards",
    href: "/docs/architecture/protocols",
    icon: <Icon d="M4 6h16M4 12h16M4 18h10" />,
    description:
      "gRPC, Connect, WebRTC, OIDC, SAML, LDAP, MLS. Wire your existing identity, observability, and secrets infrastructure in without adapters.",
  },
  {
    title: "Operate it your way",
    href: "/docs/operators/deployment",
    icon: <Icon d="M12 3v3M3 12h3M12 18v3M18 12h3M6 6l2 2M16 8l2-2M8 16l-2 2M18 18l-2-2M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />,
    description:
      "Helm charts for production Kubernetes, Docker Compose for smaller deployments. Clear upgrade paths, predictable release cadence.",
  },
];

function Feature({ title, description, icon, href }: FeatureItem): ReactNode {
  const inner = (
    <>
      <div className={styles.featureIcon}>{icon}</div>
      <Heading as="h3" className={styles.featureTitle}>
        {title}
      </Heading>
      <p className={styles.featureBody}>{description}</p>
    </>
  );
  return (
    <div className={clsx("col col--4", styles.featureCell)}>
      {href ? (
        <Link to={href} className={styles.featureCard}>
          {inner}
        </Link>
      ) : (
        <div className={styles.featureCard}>{inner}</div>
      )}
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <span className={styles.sectionEyebrow}>Why Open Huddle</span>
          <Heading as="h2" className={styles.sectionTitle}>
            Built for the organizations proprietary suites won't support
          </Heading>
        </div>
        <div className="row">
          {features.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
