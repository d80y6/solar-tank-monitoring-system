-- Migration 013: English hardware profile names.
--
-- The two seeded profiles from migration 004 were named in Indonesian. Applied
-- migrations are never edited (the ledger compares their checksum), so the
-- rename is applied here instead. The statement is idempotent: it only touches
-- rows that still carry the original name, so a database that was created after
-- the rename keeps its operator-edited names.

UPDATE monitoring_hardware_profiles
SET name = 'NodeMCU ESP8266 + HC-SR04 for rectangular tanks'
WHERE id = 'hardware-profile-nodemcu-hcsr04-rectangular-v1'
  AND name = 'NodeMCU ESP8266 + HC-SR04 untuk tangki balok';

UPDATE monitoring_hardware_profiles
SET name = 'NodeMCU ESP8266 + HC-SR04 for horizontal cylinder tanks'
WHERE id = 'hardware-profile-nodemcu-hcsr04-cylinder-v1'
  AND name = 'NodeMCU ESP8266 + HC-SR04 untuk tangki silinder horizontal';
