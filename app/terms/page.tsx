import type { Metadata } from "next";
import { LegalPage, LegalSection, MailLink } from "../components/LegalPage";

const title = "Terms of Service · StudyBuddy";
const description = "Terms for using Study Buddy, an educational Bible study aid at thelightlabs.dev.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description },
};

export default function TermsPage() {
  return (
    <LegalPage current="terms" kicker="Light Labs" title="Terms" updated="November 27, 2026">
      <p className="text-[15px] leading-relaxed text-[var(--ink)]">
        These terms cover Study Buddy at thelightlabs.dev, an educational Bible study aid operated by Light Labs (Judah
        Helland). Using Study Buddy means you agree to them.
      </p>

      <LegalSection title="The service">
        <p>
          Study Buddy builds study paths from a topic, notes, a passage, or a photo of a page. Lessons and quizzes cite
          Scripture, the confessions, and the church fathers. It is a study aid for personal study.
        </p>
      </LegalSection>

      <LegalSection title="AI-generated content">
        <p>
          Lessons and quizzes are generated with AI. They can be incomplete or wrong. Weigh them against Scripture. A
          quotation marked as retrieved comes from the library. The teaching around it is a study aid, and you should read
          the passage itself.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>
          Use Study Buddy for personal study. Do not try to break into accounts or the service, disrupt it, upload material
          you have no right to use, or use it to harass someone or to produce illegal content. We may suspend access that
          breaks these terms.
        </p>
      </LegalSection>

      <LegalSection title="Your account">
        <p>
          You are responsible for activity under the account you use to sign in. To ask us to delete the account and the
          study data stored for it, email <MailLink />.
        </p>
      </LegalSection>

      <LegalSection title="No warranty">
        <p>
          Study Buddy is provided as is. To the extent the law allows, Light Labs and Judah Helland make no warranty that
          the service will be uninterrupted, that a lesson will be accurate, or that it will fit a particular purpose, and
          they are not liable for damages that arise from using it.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about these terms: <MailLink />.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update these terms. The date above changes when we do. Continuing to use Study Buddy after an update means
          you accept the updated terms.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
