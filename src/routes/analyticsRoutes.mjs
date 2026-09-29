import { Router } from 'express';
import { PRODUCT_CATEGORIES, suggestProductCategoryCodes } from '../domain/productCategories.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { parseTaskStatisticsFilters } from '../domain/taskStatistics.mjs';

export function analyticsRoutes({ productCategoryRepository = null,
  taskStatisticsRepository = null } = {}) {
  const router = Router();

  router.use('/analytics', requireLogin);

  router.get('/analytics', (req, res) => {
    res.render('analytics/index', {
      canViewProductReport: Boolean(productCategoryRepository)
        && hasRole(req.currentUser, ROLES.ADMINISTRATOR),
      canViewTaskReport: Boolean(taskStatisticsRepository)
        && hasRole(req.currentUser, ROLES.ADMINISTRATOR)
    });
  });

  function requireTaskStatisticsAdmin(req, res, next) {
    res.set('Cache-Control', 'private, no-store');
    if (!hasRole(req.currentUser, ROLES.ADMINISTRATOR)) {
      res.status(403).send('Forbidden');
      return;
    }
    if (!taskStatisticsRepository) {
      res.status(503).send('Task statistics unavailable');
      return;
    }
    next();
  }

  async function taskStatistics(req, res, next, asJson) {
    try {
      const filters = parseTaskStatisticsFilters(req.query);
      const [report, users] = await Promise.all([
        taskStatisticsRepository.getReport(filters),
        asJson ? [] : taskStatisticsRepository.listUsers()
      ]);
      if (asJson) res.json({ filters, ...report });
      else res.render('analytics/tasks', { filters, ...report, users });
    } catch (error) {
      if (error?.statusCode === 400) {
        res.status(400).send(error.message);
      } else next(error);
    }
  }

  router.get('/analytics/tasks', requireTaskStatisticsAdmin,
    (req, res, next) => taskStatistics(req, res, next, false));
  router.get('/analytics/tasks/data', requireTaskStatisticsAdmin,
    (req, res, next) => taskStatistics(req, res, next, true));

  router.get('/analytics/products', async (req, res, next) => {
    if (!hasRole(req.currentUser, ROLES.ADMINISTRATOR)) {
      return res.status(403).send('Forbidden');
    }
    if (!productCategoryRepository) return res.status(503).send('Product report unavailable');
    const yearText = String(req.query.year || '').trim();
    const year = /^\d{4}$/.test(yearText) && Number(yearText) >= 1900 && Number(yearText) <= 2100
      ? Number(yearText) : null;
    if (yearText && year === null) return res.status(400).send('Invalid year');
    const code = String(req.query.category || '').trim();
    if (code && !PRODUCT_CATEGORIES.some((category) => category.code === code)) {
      return res.status(400).send('Invalid product category');
    }
    const reviewPageText = String(req.query.reviewPage || '1').trim();
    if (!/^[1-9]\d{0,5}$/.test(reviewPageText)) {
      return res.status(400).send('Invalid review page');
    }
    const reviewPage = Number(reviewPageText);
    const businessPageText = String(req.query.businessPage || '1').trim();
    if (!/^[1-9]\d{0,5}$/.test(businessPageText)) {
      return res.status(400).send('Invalid business review page');
    }
    const businessPage = Number(businessPageText);
    const reviewPageSize = 30;
    try {
      const [summary, customers, pendingEmailReview, pendingBusinessReview] = await Promise.all([
        productCategoryRepository.categorySummary({ year }),
        code ? productCategoryRepository.customersForCategory(code, { year }) : [],
        productCategoryRepository.pendingEmailReview({
          limit: reviewPageSize,
          offset: (reviewPage - 1) * reviewPageSize
        }),
        productCategoryRepository.pendingBusinessReview({
          limit: reviewPageSize,
          offset: (businessPage - 1) * reviewPageSize
        })
      ]);
      res.render('analytics/products', {
        categories: PRODUCT_CATEGORIES,
        summary,
        customers,
        selectedCategory: code,
        selectedYear: year,
        reviewPage,
        businessPage,
        reviewPageSize,
        pendingEmailReview: {
          total: pendingEmailReview.total,
          rows: pendingEmailReview.rows.map((row) => ({
            ...row,
            suggestedCodes: suggestProductCategoryCodes({
              subject: row.subject,
              requirementText: row.bodyText
            })
          }))
        },
        pendingBusinessReview: {
          total: pendingBusinessReview.total,
          rows: pendingBusinessReview.rows.map((row) => ({
            ...row,
            suggestedCodes: suggestProductCategoryCodes({
              productInterest: row.productInterest,
              subject: row.subject,
              requirementText: row.requirementText
            })
          }))
        }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
