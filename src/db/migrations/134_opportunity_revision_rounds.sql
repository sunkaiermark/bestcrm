CREATE TABLE opportunity_revision_rounds (
 id bigserial PRIMARY KEY,
 opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
 round_no integer NOT NULL CHECK(round_no>0),
 revision_kind text NOT NULL CHECK(revision_kind IN ('initial','technical','commercial')),
 source_email_message_id bigint REFERENCES email_messages(id) ON DELETE RESTRICT,
 closed_basis jsonb,
 feedback text NOT NULL CHECK(char_length(btrim(feedback)) BETWEEN 1 AND 4000),
 baseline jsonb NOT NULL,
 created_by bigint NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz,
 accepted_quote_kind text CHECK(accepted_quote_kind IN ('formal','legacy')),
 accepted_quote_id bigint,
 acceptance_note text,
 accepted_by bigint REFERENCES users(id),
 accepted_at timestamptz,
 UNIQUE(opportunity_id,round_no),
 CHECK((accepted_quote_id IS NULL AND accepted_quote_kind IS NULL AND accepted_by IS NULL AND accepted_at IS NULL)
   OR (accepted_quote_id IS NOT NULL AND accepted_quote_kind IS NOT NULL AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL AND char_length(btrim(acceptance_note))>0))
);
CREATE UNIQUE INDEX opportunity_revision_round_current ON opportunity_revision_rounds(opportunity_id) WHERE closed_at IS NULL;
ALTER TABLE opportunity_collaboration_work_package_versions ADD COLUMN revision_round_id bigint REFERENCES opportunity_revision_rounds(id), ADD COLUMN source_technical_version_id bigint REFERENCES opportunity_collaboration_work_package_versions(id) ON DELETE RESTRICT;
ALTER TABLE sales_commercial_quotation_versions ADD COLUMN revision_round_id bigint REFERENCES opportunity_revision_rounds(id), ADD COLUMN approval_basis jsonb;
ALTER TABLE commercial_quotes ADD COLUMN revision_round_id bigint REFERENCES opportunity_revision_rounds(id), ADD COLUMN approval_basis jsonb;
ALTER TABLE contract_approvals ADD COLUMN revision_round_id bigint REFERENCES opportunity_revision_rounds(id), ADD COLUMN final_quote_kind text, ADD COLUMN final_quote_id bigint, ADD COLUMN final_quote_snapshot jsonb;

ALTER TABLE opportunity_collaboration_work_package_files ADD COLUMN carried_from_attachment_id bigint REFERENCES attachments(id) ON DELETE RESTRICT;
ALTER TABLE requirement_updates ADD COLUMN revision_round_id bigint REFERENCES opportunity_revision_rounds(id);

CREATE TABLE opportunity_revision_attachment_links(
 revision_round_id bigint NOT NULL REFERENCES opportunity_revision_rounds(id) ON DELETE RESTRICT,
 attachment_id bigint PRIMARY KEY REFERENCES attachments(id) ON DELETE RESTRICT,
 added_by bigint NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX revision_attachment_round ON opportunity_revision_attachment_links(revision_round_id);

CREATE FUNCTION bestcrm_cost_version_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id bigint;
BEGIN
 SELECT r.id INTO NEW.revision_round_id FROM opportunity_revision_rounds r JOIN opportunity_collaboration_work_packages w ON w.opportunity_id=r.opportunity_id WHERE w.id=NEW.work_package_id AND r.closed_at IS NULL;
 SELECT source_work_package_id INTO source_id FROM opportunity_collaboration_work_packages WHERE id=NEW.work_package_id AND plan_kind='internal_quote';
 IF source_id IS NOT NULL THEN
  SELECT id INTO NEW.source_technical_version_id FROM opportunity_collaboration_work_package_versions WHERE work_package_id=source_id ORDER BY version_no DESC,id DESC LIMIT 1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cost_version_source BEFORE INSERT ON opportunity_collaboration_work_package_versions FOR EACH ROW EXECUTE FUNCTION bestcrm_cost_version_source();

CREATE FUNCTION bestcrm_quotation_basis(op_id bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
 'technical',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'packageId',t.id,'title',t.title,'versionId',v.id,'versionNo',v.version_no,'status',v.status,
   'files',COALESCE((SELECT jsonb_agg(jsonb_build_object('attachmentId',a.id,'name',a.original_name,'sha256',a.sha256,'status',f.status,'carriedFromAttachmentId',f.carried_from_attachment_id,'reviewNote',f.review_note,'reviewedAt',f.reviewed_at,'submittedAt',f.submitted_at) ORDER BY a.id)
     FROM opportunity_collaboration_work_package_files f JOIN attachments a ON a.id=f.attachment_id
     WHERE f.work_package_version_id=v.id AND f.superseded_by_attachment_id IS NULL AND a.retired_at IS NULL AND f.status<>'withdrawn'),'[]'::jsonb),
   'cost',jsonb_build_object('packageId',q.id,'versionId',qv.id,'versionNo',qv.version_no,'status',qv.status,'sourceTechnicalVersionId',qv.source_technical_version_id,
     'files',COALESCE((SELECT jsonb_agg(jsonb_build_object('attachmentId',a.id,'name',a.original_name,'sha256',a.sha256,'status',f.status,'carriedFromAttachmentId',f.carried_from_attachment_id,'reviewNote',f.review_note,'reviewedAt',f.reviewed_at,'submittedAt',f.submitted_at) ORDER BY a.id)
       FROM opportunity_collaboration_work_package_files f JOIN attachments a ON a.id=f.attachment_id
       WHERE f.work_package_version_id=qv.id AND f.superseded_by_attachment_id IS NULL AND a.retired_at IS NULL AND f.status<>'withdrawn'),'[]'::jsonb))
 ) ORDER BY t.id)
 FROM opportunity_collaboration_work_packages t
 LEFT JOIN LATERAL(SELECT * FROM opportunity_collaboration_work_package_versions WHERE work_package_id=t.id ORDER BY version_no DESC,id DESC LIMIT 1)v ON true
 LEFT JOIN opportunity_collaboration_work_packages q ON q.source_work_package_id=t.id AND q.deleted_at IS NULL
 LEFT JOIN LATERAL(SELECT * FROM opportunity_collaboration_work_package_versions WHERE work_package_id=q.id ORDER BY version_no DESC,id DESC LIMIT 1)qv ON true
 WHERE t.opportunity_id=op_id AND t.plan_kind='technical_solution' AND t.deleted_at IS NULL),'[]'::jsonb),
 'legacyTechnicalDraftId',(SELECT id FROM opportunity_technical_drafts WHERE opportunity_id=op_id AND status='approved' ORDER BY draft_revision_no DESC,id DESC LIMIT 1),
 'legacyTechnicalVersionId',(SELECT id FROM technical_solutions WHERE opportunity_id=op_id AND status='approved' ORDER BY version_no DESC,id DESC LIMIT 1),
 'requirement',jsonb_build_object('roundId',(SELECT id FROM opportunity_revision_rounds WHERE opportunity_id=op_id AND closed_at IS NULL),
   'text',COALESCE((SELECT CASE WHEN revision_kind='initial' THEN (SELECT requirement FROM opportunities WHERE id=op_id) ELSE feedback END FROM opportunity_revision_rounds WHERE opportunity_id=op_id AND closed_at IS NULL),(SELECT requirement FROM opportunities WHERE id=op_id)),
   'sourceEmailMessageId',(SELECT source_email_message_id FROM opportunity_revision_rounds WHERE opportunity_id=op_id AND closed_at IS NULL),
   'supplements',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'text',u.requirement_text) ORDER BY u.id) FROM requirement_updates u JOIN opportunity_revision_rounds r ON r.id=u.revision_round_id WHERE r.opportunity_id=op_id AND r.closed_at IS NULL),'[]'::jsonb),
   'files',COALESCE((SELECT jsonb_agg(jsonb_build_object('attachmentId',a.id,'name',a.original_name,'sha256',a.sha256) ORDER BY a.id) FROM opportunity_revision_attachment_links l JOIN attachments a ON a.id=l.attachment_id JOIN opportunity_revision_rounds r ON r.id=l.revision_round_id WHERE r.opportunity_id=op_id AND r.closed_at IS NULL AND a.category='requirement' AND a.retired_at IS NULL),'[]'::jsonb)),
 'requirementHistory',COALESCE((SELECT jsonb_agg(jsonb_build_object('roundId',r.id,'roundNo',r.round_no,'requirement',r.closed_basis->'requirement') ORDER BY r.round_no) FROM opportunity_revision_rounds r WHERE r.opportunity_id=op_id AND r.closed_at IS NOT NULL),'[]'::jsonb),
 'commercialFiles',COALESCE((SELECT jsonb_agg(jsonb_build_object('attachmentId',a.id,'name',a.original_name,'sha256',a.sha256) ORDER BY a.id) FROM opportunity_revision_attachment_links l JOIN attachments a ON a.id=l.attachment_id JOIN opportunity_revision_rounds r ON r.id=l.revision_round_id WHERE r.opportunity_id=op_id AND r.closed_at IS NULL AND a.category='commercial_quote' AND a.retired_at IS NULL),'[]'::jsonb))
$$;

CREATE FUNCTION bestcrm_revision_basis_ready(op_id bigint,basis jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE round_row opportunity_revision_rounds%ROWTYPE; item jsonb; old_item jsonb; changed boolean:=false;
BEGIN
 SELECT * INTO round_row FROM opportunity_revision_rounds WHERE opportunity_id=op_id AND closed_at IS NULL;
 IF jsonb_array_length(basis->'technical')=0 THEN
  IF COALESCE(basis->>'legacyTechnicalDraftId',basis->>'legacyTechnicalVersionId') IS NULL THEN RETURN false; END IF;
  changed := (basis->>'legacyTechnicalDraftId',basis->>'legacyTechnicalVersionId') IS DISTINCT FROM (round_row.baseline->>'legacyTechnicalDraftId',round_row.baseline->>'legacyTechnicalVersionId');
 ELSE
  FOR item IN SELECT value FROM jsonb_array_elements(basis->'technical') LOOP
   IF item->>'status' IS DISTINCT FROM 'accepted' OR item#>>'{cost,status}' IS DISTINCT FROM 'accepted'
     OR jsonb_array_length(item->'files')=0 OR jsonb_array_length(item#>'{cost,files}')=0
     OR EXISTS(SELECT 1 FROM jsonb_array_elements((item->'files') || (item#>'{cost,files}')) f WHERE f->>'status' IS DISTINCT FROM 'accepted') THEN RETURN false; END IF;
   SELECT value INTO old_item FROM jsonb_array_elements(COALESCE(round_row.baseline->'technical','[]'::jsonb)) WHERE value->>'packageId'=item->>'packageId';
   IF item#>>'{cost,sourceTechnicalVersionId}' IS NOT NULL THEN
    IF item#>>'{cost,sourceTechnicalVersionId}' IS DISTINCT FROM item->>'versionId' THEN RETURN false; END IF;
   ELSIF round_row.id IS NOT NULL AND item->>'versionId' IS DISTINCT FROM old_item->>'versionId' THEN RETURN false;
   END IF;
   changed:=changed OR item->>'versionId' IS DISTINCT FROM old_item->>'versionId';
  END LOOP;
  changed:=changed OR jsonb_array_length(basis->'technical')<>jsonb_array_length(COALESCE(round_row.baseline->'technical','[]'::jsonb));
 END IF;
 IF round_row.revision_kind='technical' AND NOT changed THEN RETURN false; END IF;
 IF round_row.revision_kind='commercial' AND changed THEN RETURN false; END IF;
 RETURN true;
END $$;

CREATE FUNCTION bestcrm_bind_quote_round() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE round_row opportunity_revision_rounds%ROWTYPE; basis jsonb; op_row opportunities%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Quotation history cannot be deleted'; END IF;
 SELECT * INTO op_row FROM opportunities WHERE id=NEW.opportunity_id FOR UPDATE;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='commercial_quotes' AND (to_jsonb(NEW)-ARRAY['status','reviewed_by','reviewed_at','review_comment']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','reviewed_at','review_comment']) THEN
   RAISE EXCEPTION 'Quotation content is immutable; create a new version';
  END IF;
  IF (NEW.revision_round_id,NEW.approval_basis) IS DISTINCT FROM (OLD.revision_round_id,OLD.approval_basis) THEN RAISE EXCEPTION 'Quotation round and approval basis are immutable'; END IF;
  IF NEW.revision_round_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IN ('approved','signed') AND OLD.status IS DISTINCT FROM NEW.status THEN
   SELECT * INTO round_row FROM opportunity_revision_rounds WHERE opportunity_id=NEW.opportunity_id AND closed_at IS NULL;
   basis:=bestcrm_quotation_basis(NEW.opportunity_id);
   IF round_row.id IS DISTINCT FROM NEW.revision_round_id OR NOT bestcrm_revision_basis_ready(NEW.opportunity_id,basis) OR basis IS DISTINCT FROM NEW.approval_basis THEN
    RAISE EXCEPTION '审批依据或修订轮次已变化，请重新生成并提交报价。';
   END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF op_row.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Archived opportunity is read-only'; END IF;
 basis:=bestcrm_quotation_basis(NEW.opportunity_id);
 SELECT * INTO round_row FROM opportunity_revision_rounds WHERE opportunity_id=NEW.opportunity_id AND closed_at IS NULL;
 IF NOT FOUND THEN
  INSERT INTO opportunity_revision_rounds(opportunity_id,round_no,revision_kind,feedback,baseline,created_by)
   VALUES(NEW.opportunity_id,1,'initial',left(COALESCE(NULLIF(op_row.requirement,''),'初始需求'),4000),basis,NEW.submitted_by) RETURNING * INTO round_row;
 END IF;
 basis:=bestcrm_quotation_basis(NEW.opportunity_id);
 IF round_row.accepted_quote_id IS NOT NULL THEN RAISE EXCEPTION '客户已接受本轮报价，请先发起新修订。'; END IF;
 IF NOT bestcrm_revision_basis_ready(NEW.opportunity_id,basis) THEN RAISE EXCEPTION '本轮技术方案及对应价格核算尚未全部批准，暂只能保存报价草稿。' USING HINT='BESTCRM_REVISION_NOT_READY'; END IF;
 NEW.revision_round_id:=round_row.id; NEW.approval_basis:=basis;
 RETURN NEW;
END $$;
CREATE TRIGGER quotation_round_binding BEFORE INSERT OR UPDATE OR DELETE ON sales_commercial_quotation_versions FOR EACH ROW EXECUTE FUNCTION bestcrm_bind_quote_round();
CREATE TRIGGER quotation_round_binding BEFORE INSERT OR UPDATE OR DELETE ON commercial_quotes FOR EACH ROW EXECUTE FUNCTION bestcrm_bind_quote_round();

CREATE FUNCTION bestcrm_bind_final_contract_quote() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE round_row opportunity_revision_rounds%ROWTYPE; quote_row record;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.opportunity_id,NEW.revision_round_id,NEW.final_quote_kind,NEW.final_quote_id,NEW.final_quote_snapshot) IS DISTINCT FROM (OLD.opportunity_id,OLD.revision_round_id,OLD.final_quote_kind,OLD.final_quote_id,OLD.final_quote_snapshot) THEN RAISE EXCEPTION 'Contract quotation binding is immutable'; END IF;
  IF NEW.revision_round_id IS NOT NULL AND NEW.status='approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
   SELECT * INTO round_row FROM opportunity_revision_rounds WHERE opportunity_id=NEW.opportunity_id AND closed_at IS NULL;
   IF round_row.id IS DISTINCT FROM NEW.revision_round_id OR (NEW.final_quote_snapshot#>'{quote,approval_basis}') IS DISTINCT FROM bestcrm_quotation_basis(NEW.opportunity_id)
     OR NOT bestcrm_revision_basis_ready(NEW.opportunity_id,bestcrm_quotation_basis(NEW.opportunity_id)) THEN RAISE EXCEPTION '合同依据已变化，不能批准历史轮次合同。'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 PERFORM id FROM opportunities WHERE id=NEW.opportunity_id FOR UPDATE;
 SELECT * INTO round_row FROM opportunity_revision_rounds WHERE opportunity_id=NEW.opportunity_id AND closed_at IS NULL;
 IF round_row.id IS NULL OR round_row.accepted_quote_id IS NULL THEN RAISE EXCEPTION '请先确认客户最终接受的报价版本，再提交合同。'; END IF;
 IF round_row.accepted_quote_kind='formal' THEN
  SELECT id,opportunity_id,status,revision_round_id,to_jsonb(v) AS snapshot INTO quote_row FROM sales_commercial_quotation_versions v WHERE id=round_row.accepted_quote_id AND status='signed';
 ELSE
  SELECT id,opportunity_id,status,revision_round_id,to_jsonb(v)||jsonb_build_object('items',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM quote_items i WHERE i.quote_id=v.id),'[]'::jsonb)) AS snapshot INTO quote_row FROM commercial_quotes v WHERE id=round_row.accepted_quote_id AND status='approved';
 END IF;
 IF quote_row.id IS NULL OR quote_row.opportunity_id<>NEW.opportunity_id OR quote_row.revision_round_id<>round_row.id
   OR NOT bestcrm_revision_basis_ready(NEW.opportunity_id,bestcrm_quotation_basis(NEW.opportunity_id))
   OR (quote_row.snapshot->'approval_basis') IS DISTINCT FROM bestcrm_quotation_basis(NEW.opportunity_id) THEN RAISE EXCEPTION '最终报价或技术核算依据已变化，请重新确认。'; END IF;
 NEW.revision_round_id:=round_row.id; NEW.final_quote_kind:=round_row.accepted_quote_kind;
 NEW.final_quote_id:=round_row.accepted_quote_id;
 NEW.final_quote_snapshot:=jsonb_build_object('roundNo',round_row.round_no,'quote',quote_row.snapshot,'acceptanceNote',round_row.acceptance_note,'acceptedAt',round_row.accepted_at);
 RETURN NEW;
END $$;
CREATE TRIGGER contract_final_quote_binding BEFORE INSERT OR UPDATE ON contract_approvals FOR EACH ROW EXECUTE FUNCTION bestcrm_bind_final_contract_quote();

-- New contracts bind directly to a customer-accepted formal/file quotation.
-- Historical contracts retain their original accepted-package constraint.
CREATE OR REPLACE FUNCTION validate_contract_quotation_package_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE package_opportunity_id bigint; package_status text;
BEGIN
 IF NEW.revision_round_id IS NOT NULL AND NEW.final_quote_id IS NOT NULL AND NEW.final_quote_snapshot IS NOT NULL THEN RETURN NEW; END IF;
 IF NEW.quotation_package_version_id IS NULL THEN RAISE EXCEPTION 'Contract approval requires an accepted quotation package from the same opportunity'; END IF;
 SELECT opportunity_id,status INTO package_opportunity_id,package_status FROM quotation_package_versions WHERE id=NEW.quotation_package_version_id;
 IF package_opportunity_id IS DISTINCT FROM NEW.opportunity_id OR package_status IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'Contract approval requires an accepted quotation package from the same opportunity'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION bestcrm_guard_round_quotation_email() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE quote_round bigint; current_round bigint;
BEGIN
 IF NEW.sales_quotation_version_id IS NULL OR NEW.delivery_status NOT IN ('pending','sent') THEN RETURN NEW; END IF;
 SELECT revision_round_id INTO quote_round FROM sales_commercial_quotation_versions WHERE id=NEW.sales_quotation_version_id;
 SELECT id INTO current_round FROM opportunity_revision_rounds WHERE opportunity_id=(SELECT opportunity_id FROM email_threads WHERE id=NEW.thread_id) AND closed_at IS NULL;
 IF current_round IS NOT NULL AND quote_round IS DISTINCT FROM current_round THEN RAISE EXCEPTION '这是历史轮次的报价，请选择当前轮次的已签发报价。'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER round_quotation_email BEFORE INSERT OR UPDATE OF sales_quotation_version_id,delivery_status ON email_messages FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_round_quotation_email();

COMMENT ON TABLE opportunity_revision_rounds IS 'Negotiation rounds; historical quotations and customer acceptance retained. Historical pre-migration quotations are deliberately not assigned invented rounds.';

CREATE FUNCTION bestcrm_guard_revision_round() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE quote_row record;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Revision rounds cannot be deleted'; END IF;
 IF (NEW.opportunity_id,NEW.round_no,NEW.revision_kind,NEW.feedback,NEW.baseline,NEW.created_by,NEW.created_at,NEW.source_email_message_id)
  IS DISTINCT FROM (OLD.opportunity_id,OLD.round_no,OLD.revision_kind,OLD.feedback,OLD.baseline,OLD.created_by,OLD.created_at,OLD.source_email_message_id)
  OR (OLD.closed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD)
  OR (OLD.accepted_quote_id IS NOT NULL AND (NEW.accepted_quote_id,NEW.accepted_quote_kind,NEW.accepted_by,NEW.accepted_at,NEW.acceptance_note)
    IS DISTINCT FROM (OLD.accepted_quote_id,OLD.accepted_quote_kind,OLD.accepted_by,OLD.accepted_at,OLD.acceptance_note)) THEN RAISE EXCEPTION 'Revision history and customer acceptance are immutable'; END IF;
 IF NEW.accepted_quote_id IS NOT NULL AND OLD.accepted_quote_id IS NULL THEN
  IF NEW.accepted_quote_kind='formal' THEN
   SELECT opportunity_id,revision_round_id,approval_basis INTO quote_row FROM sales_commercial_quotation_versions WHERE id=NEW.accepted_quote_id AND status='signed';
  ELSE
   SELECT opportunity_id,revision_round_id,approval_basis INTO quote_row FROM commercial_quotes WHERE id=NEW.accepted_quote_id AND status='approved';
  END IF;
  IF quote_row.opportunity_id IS DISTINCT FROM NEW.opportunity_id OR quote_row.revision_round_id IS DISTINCT FROM NEW.id
    OR quote_row.approval_basis IS DISTINCT FROM bestcrm_quotation_basis(NEW.opportunity_id)
    OR NOT bestcrm_revision_basis_ready(NEW.opportunity_id,quote_row.approval_basis) THEN RAISE EXCEPTION 'Only a current approved quotation with matching technical and cost basis may be accepted'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER revision_round_history BEFORE UPDATE OR DELETE ON opportunity_revision_rounds FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_revision_round();

CREATE FUNCTION bestcrm_guard_quote_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent commercial_quotes%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Quotation items are immutable; create a new version'; END IF;
 SELECT * INTO parent FROM commercial_quotes WHERE id=NEW.quote_id FOR UPDATE;
 IF parent.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'Quotation items are frozen after review'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER quotation_item_history BEFORE INSERT OR UPDATE OR DELETE ON quote_items FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_quote_items();

CREATE FUNCTION bestcrm_guard_revision_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r opportunity_revision_rounds%ROWTYPE; a attachments%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Requirement attachment association is immutable'; END IF;
 SELECT * INTO r FROM opportunity_revision_rounds WHERE id=NEW.revision_round_id;
 SELECT * INTO a FROM attachments WHERE id=NEW.attachment_id;
 IF r.id IS NULL OR a.id IS NULL OR r.opportunity_id<>a.opportunity_id OR a.category NOT IN ('requirement','commercial_quote') OR r.closed_at IS NOT NULL OR r.accepted_quote_id IS NOT NULL THEN
  RAISE EXCEPTION '需求轮次或附件已变化，请刷新后重试。';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER revision_attachment_guard BEFORE INSERT OR UPDATE OR DELETE ON opportunity_revision_attachment_links FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_revision_attachment();
