INSERT INTO monitoring_sites
  (id, code, name, area_label, regional_label, wilayah_label, latitude, longitude, is_active)
VALUES
  ('site-sah', 'SAH', 'HSA SAH', 'Al Jamanh', 'Bani Al hareth', 'Amanat Alasemah', 15.369445, 44.191006, TRUE)
ON DUPLICATE KEY UPDATE
  code = VALUES(code),
  name = VALUES(name),
  area_label = VALUES(area_label),
  regional_label = VALUES(regional_label),
  wilayah_label = VALUES(wilayah_label),
  latitude = VALUES(latitude),
  longitude = VALUES(longitude),
  is_active = VALUES(is_active);

INSERT INTO monitoring_tanks
  (
    id,
    site_id,
    name,
    shape,
    capacity_liter,
    diameter_cm,
    length_cm,
    sensor_mount_height_cm,
    low_level_percent,
    critical_level_percent,
    consumption_liter_per_hour,
    is_active
  )
VALUES
  ('tank-sah-main', 'site-sah', 'Gasolin Tank', 'horizontal-cylinder', 29000, 290, 500, 290, 30, 15, 25, TRUE)
ON DUPLICATE KEY UPDATE
  site_id = VALUES(site_id),
  name = VALUES(name),
  shape = VALUES(shape),
  capacity_liter = VALUES(capacity_liter),
  diameter_cm = VALUES(diameter_cm),
  length_cm = VALUES(length_cm),
  sensor_mount_height_cm = VALUES(sensor_mount_height_cm),
  low_level_percent = VALUES(low_level_percent),
  critical_level_percent = VALUES(critical_level_percent),
  consumption_liter_per_hour = VALUES(consumption_liter_per_hour),
  is_active = VALUES(is_active);

INSERT INTO monitoring_devices
  (
    id,
    site_id,
    tank_id,
    code,
    label,
    expected_report_interval_sec,
    api_key_hash,
    is_active
  )
VALUES
  ('device-tph-main', 'site-sah', 'tank-sah-main', 'sens-sah-01', 'NodeMCU Ultrasonic', 300, 'sha256:749a381823e9c3e494badf95003e255a389eb65b1f894a058a54f27b1834d1f4', TRUE)
  ON DUPLICATE KEY UPDATE
  site_id = VALUES(site_id),
  tank_id = VALUES(tank_id),
  code = VALUES(code),
  label = VALUES(label),
  expected_report_interval_sec = VALUES(expected_report_interval_sec),
  api_key_hash = VALUES(api_key_hash),
  is_active = VALUES(is_active);
