ALTER TABLE opportunity_collaboration_work_package_versions ADD COLUMN approved_version_no integer CHECK(approved_version_no>0);
WITH approved AS (
  SELECT id,row_number() OVER(PARTITION BY work_package_id ORDER BY version_no)::integer AS n
  FROM opportunity_collaboration_work_package_versions WHERE status='accepted'
) UPDATE opportunity_collaboration_work_package_versions v SET approved_version_no=a.n FROM approved a WHERE v.id=a.id;
CREATE UNIQUE INDEX collaboration_approved_version_unique ON opportunity_collaboration_work_package_versions(work_package_id,approved_version_no) WHERE approved_version_no IS NOT NULL;
