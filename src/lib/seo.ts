import { useEffect } from 'react';

const SITE_NAME = 'TrendCutFlow';
const DEFAULT_TITLE = 'TrendCutFlow — Turn Long Videos into Viral 9:16 Shorts with AI';
const DEFAULT_DESCRIPTION =
  'Upload any long-form video and let AI extract the most engaging moments as ready-to-publish vertical shorts. No editing skills needed.';
const SITE_URL = 'https://trendcutflow.com';
const OG_IMAGE = `${SITE_URL}/og-image.png`;

export interface HeadMeta {
  title?: string;
  description?: string;
  ogImage?: string;
  ogUrl?: string;
  ogType?: 'website' | 'article';
  noindex?: boolean;
}

function setMetaTag(attr: 'name' | 'property', key: string, content: string) {
  let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function removeMetaTag(attr: 'name' | 'property', key: string) {
  const el = document.querySelector(`meta[${attr}="${key}"]`);
  if (el) el.remove();
}

export function useDocumentHead(meta: HeadMeta) {
  useEffect(() => {
    const title = meta.title ? `${meta.title} | ${SITE_NAME}` : DEFAULT_TITLE;
    const description = meta.description || DEFAULT_DESCRIPTION;
    const ogImage = meta.ogImage || OG_IMAGE;
    const ogUrl = meta.ogUrl || SITE_URL;
    const ogType = meta.ogType || 'website';

    document.title = title;

    // Standard meta
    setMetaTag('name', 'description', description);

    // Robots
    if (meta.noindex) {
      setMetaTag('name', 'robots', 'noindex, nofollow');
    } else {
      setMetaTag('name', 'robots', 'index, follow');
    }

    // Open Graph
    setMetaTag('property', 'og:title', title);
    setMetaTag('property', 'og:description', description);
    setMetaTag('property', 'og:image', ogImage);
    setMetaTag('property', 'og:url', ogUrl);
    setMetaTag('property', 'og:type', ogType);
    setMetaTag('property', 'og:site_name', SITE_NAME);

    // Twitter/X Card
    setMetaTag('name', 'twitter:card', 'summary_large_image');
    setMetaTag('name', 'twitter:title', title);
    setMetaTag('name', 'twitter:description', description);
    setMetaTag('name', 'twitter:image', ogImage);

    return () => {
      // Cleanup noindex when leaving protected pages
      if (meta.noindex) {
        removeMetaTag('name', 'robots');
      }
    };
  }, [meta.title, meta.description, meta.ogImage, meta.ogUrl, meta.ogType, meta.noindex]);
}

// Pre-defined route metadata
export const SEO = {
  landing: {
    title: undefined, // Uses DEFAULT_TITLE (already keyword-optimized)
    description: DEFAULT_DESCRIPTION,
    ogUrl: SITE_URL,
  },
  auth: {
    title: 'Sign In',
    description: 'Sign in or create an account to start turning your long videos into viral short-form content with AI.',
    ogUrl: `${SITE_URL}/auth`,
  },
  dashboard: {
    title: 'Dashboard',
    description: 'Upload a video and let AI find the most viral moments. Your workspace for creating 9:16 shorts.',
    ogUrl: `${SITE_URL}/dashboard`,
    noindex: true,
  },
  processing: {
    title: 'Processing Video',
    description: 'Your video is being analyzed by AI to extract the best viral clips.',
    noindex: true,
  },
  editor: {
    title: 'Clip Editor',
    description: 'Fine-tune your AI-extracted clips with subtitles, presets, and one-click publishing.',
    noindex: true,
  },
  history: {
    title: 'History',
    description: 'View and manage all your previously processed videos and extracted clips.',
    noindex: true,
  },
  pricing: {
    title: 'Pricing — Plans That Scale With You',
    description: 'Choose the plan that fits your content creation workflow. From free starter to unlimited pro — upgrade anytime.',
    ogUrl: `${SITE_URL}/pricing`,
  },
  terms: {
    title: 'Terms of Service',
    description: 'Read the terms and conditions governing your use of TrendCutFlow.',
    ogUrl: `${SITE_URL}/terms`,
  },
  privacy: {
    title: 'Privacy Policy',
    description: 'Learn how TrendCutFlow collects, uses, and protects your personal information.',
    ogUrl: `${SITE_URL}/privacy`,
  },
  refund: {
    title: 'Refund Policy',
    description: 'Understand our refund and cancellation policy for paid plans.',
    ogUrl: `${SITE_URL}/refund`,
  },
  contact: {
    title: 'Contact Us',
    description: 'Get in touch with the TrendCutFlow team for support, partnerships, or feedback.',
    ogUrl: `${SITE_URL}/contact`,
  },
} as const;
