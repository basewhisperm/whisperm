# Nana's Nest — nanasnestcare.com

A static marketing website for **Nana's Nest**, a high-end, referral-based newborn night
nursing and infant sleep training service serving Washington, DC, Maryland, and Northern
Virginia.

Plain HTML/CSS/JS — no build step, no framework, no dependencies. Any static host works.

## Structure

```
sites/nanas-nest-website/
├── index.html                          Home
├── about.html
├── contact.html                        Inquiry form + direct contact info
├── testimonials.html
├── faq.html                            FAQPage schema
├── privacy.html
├── 404.html
├── services/
│   ├── index.html                      Services overview / comparison
│   ├── newborn-night-nursing.html
│   └── sleep-training.html
├── areas/
│   ├── washington-dc.html
│   ├── maryland.html
│   └── northern-virginia.html
├── blog/                               "The Nest Journal" — long-tail SEO content
│   ├── index.html
│   ├── 4-month-sleep-regression-survival-guide.html
│   ├── night-nurse-vs-postpartum-doula.html
│   ├── cost-of-a-night-nurse-dc-maryland-virginia.html
│   └── gentle-sleep-training-methods-explained.html
├── assets/{css,js,img}/
├── robots.txt
└── sitemap.xml
```

All pages were generated from a small Node script (kept outside this folder, in the build
session's scratch space — not part of this deliverable) so that header/footer/nav, meta tags,
and JSON-LD stay perfectly consistent across all 18 pages. The output here is plain static
HTML; nothing needs to be built or compiled to edit or host it.

## Real contact info wired in

- **Phone**: (443) 600-0583 (`tel:+14436000583`), site-wide.
- **Email**: nanasnestcare@gmail.com, site-wide.
- **Google Business Profile**: linked from the footer ("Read Our Google Reviews") on every page,
  from a callout at the top of `testimonials.html`, and from a "Read Our Google Reviews" button
  in the home page testimonials section — https://maps.app.goo.gl/6T9wRKmPQMcSRZr78. It's also
  listed in the `sameAs` array of the `ChildCare` structured data on the home and area pages,
  which helps Google associate this website with that Business Profile.

  **Note on reviews**: this build environment's network egress blocks Google Maps and Facebook,
  so I couldn't fetch the Profile's actual star rating, review count, or review text — nothing
  on the site states a rating/count, and the sample testimonials are explicitly labeled as
  illustrative, not real quotes (see below), so nothing false is asserted. If you'd like 3–6 real
  reviews featured as verbatim testimonials, copy them over from the Business Profile (reviewer
  first name + last initial, as Google displays them, plus their star rating) and I can drop them
  into `testimonials.html` and the home page in place of the samples.

## Before you launch — remaining placeholders

1. **Contact form action** — `contact.html` posts to
   `https://formspree.io/f/YOUR_FORM_ID`. It also carries `data-netlify="true"` so it works
   out of the box if hosted on Netlify. If you're not using Netlify, sign up for a form backend
   (Formspree, Basin, etc.) and swap in your real endpoint — or wire it to your own API.
2. **Testimonials** (`testimonials.html`, and the 3 featured on the home page) are
   **placeholder / sample copy**, written in a realistic style but not real client quotes — each
   is labeled as such on the page. Replace them with real, permission-granted feedback (from
   Google or direct client outreach) before publishing.
3. **Social link** — `instagram.com/nanasnestcare` is a placeholder handle; point it at your
   real profile (or remove it).
4. **Pricing language** in `blog/cost-of-a-night-nurse-dc-maryland-virginia.html` is
   intentionally general ("mid-double-digit hourly range") rather than a firm quote — update it
   to reflect your actual rates, or keep it general and rely on the contact form for quotes.
5. **Privacy policy** (`privacy.html`) is a plain-language starting point, not legal advice —
   have it reviewed by counsel before launch.

## Deploying

Any static host works — no server, database, or build step required:

- **Netlify / Vercel / Cloudflare Pages**: point the project at this folder and deploy. Netlify
  will also pick up the contact form automatically (`data-netlify="true"`).
- **Any other static host** (S3+CloudFront, GitHub Pages, etc.): upload the contents of this
  folder as-is.

Point `nanasnestcare.com` (and `www.nanasnestcare.com`, redirected to the apex) at your host via
DNS. All canonical URLs, Open Graph tags, and `sitemap.xml`/`robots.txt` assume the apex domain
`https://nanasnestcare.com` — if you deploy on `www` instead, do a find/replace across the HTML
files and `sitemap.xml`/`robots.txt`.

## SEO approach

- **Primary keywords** — "newborn night nurse," "night nursing," "infant/baby sleep training,"
  "sleep consultant," each paired with DC/Maryland/Northern Virginia — targeted through the two
  service pages and three service-area pages (with neighborhood-level content: Bethesda, Chevy
  Chase, Potomac, McLean, Great Falls, Arlington, Georgetown, Capitol Hill, etc.).
- **Long-tail keywords** — captured through `faq.html` (14 real question-phrased queries, marked
  up with `FAQPage` schema for potential rich results) and four blog posts targeting specific
  searches: the 4-month sleep regression, night nurse vs. postpartum doula, night nurse cost in
  the DMV, and gentle sleep training methods.
- **Structured data** — `ChildCare`/`LocalBusiness` schema (home + each area page), `Service`
  schema (both service pages), `Article` schema (blog posts), `FAQPage` schema (FAQ page), and
  `BreadcrumbList` on every inner page.
- **On-page basics** — unique, length-budgeted `<title>`/meta description per page, one `<h1>`
  per page, canonical URLs, Open Graph + Twitter Card tags with a generated 1200×630 share image,
  descriptive internal linking between services ↔ areas ↔ blog ↔ FAQ, semantic HTML, and no
  render-blocking JS.
- **Technical** — `sitemap.xml` and `robots.txt` are included and cross-checked against the
  actual file list; update `sitemap.xml` if you add/remove pages later.

## After launch

- Submit `sitemap.xml` in Google Search Console and Bing Webmaster Tools.
- The Google Business Profile is already linked from the site; make sure its listed phone
  ((443) 600-0583) and service area match this site exactly, and add nanasnestcare.com as its
  website URL if it isn't already — that link is a two-way local-SEO signal.
- Keep the NAP (name/phone/service-area wording) identical here and on any directory or profile
  you list the business on (Google Business Profile, Yelp, Doula Match, etc.) — consistency is a
  local-SEO ranking factor.
- As real testimonials, credentials, and blog posts accumulate, add them — the structure here
  (testimonial cards, blog cards, FAQ items) is written to make that a copy-paste job, not a
  redesign.
