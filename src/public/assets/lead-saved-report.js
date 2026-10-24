for (const form of document.querySelectorAll('[data-saved-customer-report]')) {
  const generate = form.querySelector('[data-report-generate]');
  const submit = form.querySelector('button[type="submit"]');
  const report = form.elements.customerAnalysisReport;
  const reviewed = form.elements.reportReviewed;
  const status = form.querySelector('[data-report-status]');
  report.addEventListener('input', () => { reviewed.checked = false; });
  generate?.addEventListener('click', async () => {
    if (!window.confirm('允许将需求描述及产品信息提交豆包进行匹配分析，并对询价方、最终用户和项目地点进行联网调查吗？结果需人工审阅后保存。')) return;
    if (report.value.trim() && !window.confirm('重新生成成功后会替换当前编辑框中的报告，是否继续？')) return;
    generate.disabled = true;
    submit.disabled = true;
    report.readOnly = true;
    reviewed.checked = false;
    status.textContent = '正在调查客户及胜开尔产品匹配情况，联网调查可能需要数分钟，请勿重复点击。';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 270000);
    try {
      const response = await fetch(form.action + '/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ _csrf: form.elements._csrf?.value,
          reportRevision: form.elements.reportRevision.value, consent: true })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.text) throw new Error(data.error || '报告生成失败，请稍后重试。');
      report.value = data.text;
      form.elements.reportGenerationToken.value = data.token;
      status.textContent = '报告已生成，尚未保存。请核对内容及信息来源，确认后点击“保存报告”。';
    } catch (error) {
      status.textContent = ['AbortError','TimeoutError'].includes(error.name)
        ? '报告生成超时，原报告已保留，请稍后重试。'
        : (error.message || '生成失败，原报告已保留。');
    } finally {
      clearTimeout(timer);
      generate.disabled = false;
      submit.disabled = false;
      report.readOnly = false;
    }
  });
  form.addEventListener('submit', () => { submit.disabled = true; });
}
