import type { Metadata } from "next";
import { LegalPage, LegalSection, MailLink } from "../components/LegalPage";

const title = "Privacy Policy · StudyBuddy";
const description =
  "How Study Buddy at thelightlabs.dev handles sign-in, study paths, and AI-generated lessons.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description },
};

export default function PrivacyPage() {
  return (
    <LegalPage current="privacy" kicker="Light Labs" title="Privacy" updated="November 27, 2026">
      <p className="text-[15px] leading-relaxed text-[var(--ink)]">
        Study Buddy at thelightlabs.dev is an educational Bible study aid operated by Light Labs (Judah Helland). This page
        says what the app keeps, what it sends to a model, and how to ask for deletion.
      </p>

      <LegalSection title="Who we are">
        <p>
          Study Buddy is operated by Light Labs / Judah Helland. Write to <MailLink /> with any privacy question.
        </p>
      </LegalSection>

      <LegalSection title="Sign-in">
        <p>
          Study Buddy uses Clerk for authentication, including optional Google sign-in. If you choose Google, Google shares
          the name and email address on that account with Clerk so Study Buddy can sign you in and recognize you later. We
          use that information to run your account. We do not use it for advertising.
        </p>
        <p>
          Sign in with ChatGPT is a separate, optional choice. If you connect a ChatGPT plan, a token is stored for your
          account and used only when the primary model fails and a fallback model is configured.
        </p>
        <p>A cookie keeps you signed in.</p>
      </LegalSection>

      <LegalSection title="What we store">
        <p>
          Your study paths, lessons, notes, and quiz progress are stored on Cloudflare for your account, in Durable Object
          storage. The shared Scripture and confession library that lessons cite is stored in Cloudflare D1. That library is
          the same for every learner. A photo you upload is stored in Cloudflare R2 so the app can read the page for your
          path.
        </p>
      </LegalSection>

      <LegalSection title="Lessons and quizzes">
        <p>
          When Study Buddy builds or continues a path, it sends your study prompts to AI models to generate lessons and
          quizzes. A prompt can include the topic, notes, passages, and the lesson you are on. Text from a photo is read by a
          model so it can be included. Scripture quotations shown as retrieved text come from the library.
        </p>
      </LegalSection>

      <LegalSection title="We do not sell personal data">
        <p>
          Study Buddy does not sell personal data. We do not share it with advertisers. The services that run the app
          receive what they need to do their job: Clerk for sign-in, Cloudflare for storage and for reaching AI models, and
          those models to write lessons and quizzes.
        </p>
      </LegalSection>

      <LegalSection title="Deletion">
        <p>
          Email <MailLink /> to delete your account and the study data stored for it. Include the email you used to sign in
          so we can find the account.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
