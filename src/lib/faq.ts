export type FaqLike = { question: string; answer: string };

/**
 * Drops FAQ pairs with a blank question or answer before they reach a page.
 *
 * The admin write paths reject empty answers, but a row written straight to the
 * `faqs` table bypasses them, and every FAQ surface feeds one array to both the
 * visible list and the FAQPage JSON-LD — so a single blank row ships an empty
 * <p> *and* an `acceptedAnswer.text: ""`, which is invalid structured data.
 *
 * Shared rather than hand-rolled per route so the five surfaces (homepage,
 * estate detail, 深井 district page, corridor hub, corridor segment) cannot
 * drift apart. Kept dependency-free so it is directly testable under
 * `node --test`.
 */
export function renderableFaqs<T extends FaqLike>(faqs: T[]): T[] {
  return faqs.filter((faq) => faq.question.trim().length > 0 && faq.answer.trim().length > 0);
}
