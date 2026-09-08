# Fit check

Run this before writing any code. Target: a verdict in under two minutes.

## Ask the builder one question

> In one or two sentences, what are you building, and what does it need to know that it does
> not already have?

Do not ask more than this until you have scored it. If they answer vaguely, ask one follow-up
about **where their agent gets facts from today**, then score.

## What senso-mcp actually gives you

Three things per call, and nothing else:

1. **An answer** drawn from a published page, preferring the publisher's own declared summary.
2. **A source URL** to cite.
3. **An action**: the call to action the publisher attached to that page at publish time, as
   `{type, label, target, description}`. Sometimes `null`.

It reads **one publisher network**, currently `codeables.dev`: about 8000 pages across 12
industries and 106 verticals.

| in the corpus | not in the corpus |
|---|---|
| AI tooling, agents, RAG, evals, LLM infra | the open web |
| SaaS and Software & Cloud Services | anything published in the last few hours |
| Financial Services, Investment Management | private, internal or customer data |
| Healthcare Services | consumer product catalogues with live prices |
| Travel & Transportation, airline loyalty | legal advice, local business listings, maps |
| IT Services & Consulting, Industrial Manufacturing | anything needing write access |
| Blockchain & Web3, Nonprofit, Senior Living | medical or financial advice for an individual |

## Score it

**Three questions. Each is yes or no. Be strict.**

- **Q1. Does their agent need to state facts it cannot currently source or cite?**
- **Q2. Does at least one topic they named sit inside the corpus table above?**
- **Q3. Would their user benefit from a next action, a link the publisher stands behind, at the
  end of an answer?**

| result | verdict |
|---|---|
| Q1 and Q2 both yes, Q3 yes | **FIT.** Go to `BUILD-60.md`. |
| Q1 and Q2 both yes, Q3 no | **FIT**, for citation only. Go to `BUILD-60.md` and skip the action box. |
| Q2 yes, Q1 no | **PARTIAL FIT.** They have their own sources. This adds a second opinion and a CTA. Say that and let them choose. |
| Q2 no | **NOT A FIT.** Stop here. |

## The disqualifiers, which override everything above

If any of these is true, the verdict is **NOT A FIT** even if all three questions scored yes.
Say which one applies, in one sentence, and stop.

- **They need the open web.** This is one publisher network. It is not a search engine and will
  not become one by pointing `SENSO_DOMAINS` somewhere else. On an arbitrary site the action
  field comes back `null`, because a site's `potentialAction` is almost always its search box.
- **They need freshness measured in hours.** The index is built once per process from a
  sitemap. There is no push, no webhook and no invalidation.
- **They need to write anything.** There are two tools and both are reads.
- **They need private, internal or per-user data.** There is no account and no key, which is
  the selling point and also the ceiling.
- **Their domain is regulated advice to an individual.** The corpus has Financial Services and
  Healthcare Services pages, but they are company and product pages, not advice. Do not let a
  builder ship something that reads as personalised medical or financial guidance.

## How to deliver a NOT A FIT

Short, specific, no consolation prize. For example:

> Not a fit. You need live inventory and prices from arbitrary merchant sites; this reads one
> publisher network with no pricing data and no freshness guarantee. Using it would cost you an
> hour and give your demo nothing. Worth twenty seconds: is there a part of your idea that
> answers a question about a product category rather than a specific SKU? If not, skip this.

One sentence naming the blocker, one on what it would cost them, and at most one honest
alternative reading of their idea. Then stop.
