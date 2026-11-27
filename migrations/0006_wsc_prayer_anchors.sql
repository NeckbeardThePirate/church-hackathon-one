-- Westminster Shorter Catechism Q98–Q107 expound prayer and the Lord's Prayer,
-- but Creeds.json ships that catechism with no Proofs array, so verse retrieval
-- never reached them. These rows are passage anchors (Matthew 6:9–13 and Luke 11:2–4),
-- not proof texts printed in the catechism.

DELETE FROM confession_proofs WHERE section_id IN (
  'westminster_shorter_catechism:Q98',
  'westminster_shorter_catechism:Q99',
  'westminster_shorter_catechism:Q100',
  'westminster_shorter_catechism:Q101',
  'westminster_shorter_catechism:Q102',
  'westminster_shorter_catechism:Q103',
  'westminster_shorter_catechism:Q104',
  'westminster_shorter_catechism:Q105',
  'westminster_shorter_catechism:Q106',
  'westminster_shorter_catechism:Q107'
);

-- Matthew 6:9–13, the prayer itself, for the two questions about prayer as a whole.
INSERT INTO confession_proofs VALUES ('westminster_shorter_catechism:Q98', 40, 6000009, 6000013);
INSERT INTO confession_proofs VALUES ('westminster_shorter_catechism:Q98', 42, 11000002, 11000004);
INSERT INTO confession_proofs VALUES ('westminster_shorter_catechism:Q99', 40, 6000009, 6000013);
INSERT INTO confession_proofs VALUES ('westminster_shorter_catechism:Q99', 42, 11000002, 11000004);
-- Preface and six petitions, each anchored to its line in Matthew 6.
INSERT INTO confession_proofs VALUES ('westminster_shorter_catechism:Q100', 40, 6000009, 6000009);
INSERT INTO confession_proofs VALUES ('westminster_shorter_catechism:Q101', 40, 6000009, 6000009);
INSERT INTO confession_proofs VALUES ('westminster_shorter_catechism:Q102', 40, 6000010, 6000010);
INSERT INTO confession_proofs VALUES ('westminster_shorter_catechism:Q103', 40, 6000010, 6000010);
INSERT INTO confession_proofs VALUES ('westminster_shorter_catechism:Q104', 40, 6000011, 6000011);
INSERT INTO confession_proofs VALUES ('westminster_shorter_catechism:Q105', 40, 6000012, 6000012);
INSERT INTO confession_proofs VALUES ('westminster_shorter_catechism:Q106', 40, 6000013, 6000013);
INSERT INTO confession_proofs VALUES ('westminster_shorter_catechism:Q107', 40, 6000013, 6000013);
