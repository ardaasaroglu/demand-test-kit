# Playbook: running a demand test well

A demand test answers one question before you build: will enough of the right people want this, at a price that works? The kit does the mechanics. This page is about the decisions around it, in the order you make them.

## 1. Write down the decision first

Before you write the page, answer three questions in a sentence each:

* **Who is it for?** One group you can reach, such as "people who grow vegetables on an allotment".
* **What would make you build it?** A conversion rate, at a price, from that group.
* **What would make you drop it?** A conversion rate below which the idea does not work, whatever the page says.

Then put the numbers into `killRule` in `kit.config.json`, commit, and only then share the link. The commit date is your proof that the bar did not move after you saw the data.

## 2. Pick the bars

The two rates come from your own numbers, not from a benchmark. An example, with made-up figures:

* You need 100 paying customers in the first month for the product to be worth running.
* You expect about 1 in 5 waitlist sign-ups to pay at launch. Your own guess, written down.
* So you need 500 sign-ups. If you can bring about 5,000 visitors to the launch, you need a 10% sign-up rate. That is the go bar.
* At 2%, the same 5,000 visitors bring only 100 sign-ups, a fifth of what you need. That is the kill floor.

`goMinSignups` stops a GO on a handful of people: a lower bound can clear the bar with very few sign-ups when traffic is small. Keep it at 10 or more.

## 3. Pick the prices

* **Two or three prices, far apart.** A small test only tells apart rates that differ by about a factor of two. $5 against $6 will not separate. $5 against $12 might.
* **Prices you would really charge.** The page shows them as the planned price.
* **Revenue, not conversion.** The cheapest price almost always converts best. The report ranks prices by revenue per visitor, which is what you would live on.

## 4. Plan the sample

Visitors needed per price, at 5% significance and 80% power:

| From | To | Visitors per price |
| --- | --- | --- |
| 5% | 10% | 435 |
| 3% | 6% | 749 |
| 2% | 4% | 1,141 |
| 5% | 7.5% | 1,471 |

Multiply by the number of prices. If you cannot reach that many people in `test.maxDays`, test fewer prices, or accept that you are only screening for a strong signal. Set `minVisitorsPerVariant` to what you can reach, and at least 100.

## 5. Write an honest page

* Say what it does in one sentence, for the group you picked. Specific beats clever.
* Say it is not available yet. The kit puts this before the email field. Keep it there.
* Never ask for payment details. A fake checkout teaches you little more than a waitlist, and it costs trust.
* Keep the FAQ answer that explains why someone else may see another price.
* Read your `/privacy` page once, as a visitor would.

## 6. Tag and share

Give every place its own tag, and write the list down before you post:

```text
/?src=newsletter
/?src=allotment-forum
/?src=friends
```

* Post the same page everywhere. Different wording per channel is a different test.
* Do not buy traffic for a demand test unless that is how you will sell. Paid clicks from a broad audience measure the ad, not the idea.
* Count yourself out: in cookie mode, open `/api/optout` in each browser you use before you look at the page. Your own checks are then not recorded.

## 7. Look rarely, decide once

* Run at least a full week, so weekdays and weekends both count.
* Look once a day at most. Every look is another chance to stop on noise. Checking a significance test repeatedly and stopping at the first win pushed false positives to 26.1% in [Evan Miller's simulation](https://www.evanmiller.org/how-not-to-run-an-ab-test.html).
* If you will look more often, set `confidence` to 0.99 before the test starts.
* Do not change the page or the prices during the test. If you must, use new variant ids. The report leaves out the old ones.

## 8. Act on the verdict

| Verdict | What to do |
| --- | --- |
| NOT ENOUGH DATA | Keep sharing. The report says how many visitors are missing. |
| KEEP RUNNING | Keep sharing until the time is up. Do not move the bars. |
| GO | Build the smallest paid version. Write to the list and ask for a pre-order or a paid pilot at the winning price. |
| KILL | Stop. Write down what you learned, and test the next idea or a different group. |
| TIME UP | Do what you decided in step 1. "Inconclusive" is a result too: the signal is not strong enough to bet on. |

The price line is separate from the verdict. With no clear winner, pick the price that fits your costs, or run a second, smaller test between the top two.

## 9. Close the loop

* **Email the list once**, soon, while people remember why they joined. Ask them to confirm, and ask one question about what they would pay for.
* **Treat sign-ups as intent, not sales.** Fewer people pay than join. A pre-order or a paid pilot is the next, stronger test.
* **Keep your promises.** Delete people who ask (`npm run forget -- person@example.com`), and let the daily clean-up delete the rest when `retentionDays` runs out. Export the list first if you still need it.
