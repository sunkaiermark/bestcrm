export function attachCurrentUser(userRepository) {
  return async (req, res, next) => {
    try {
      const userId = req.session?.userId;
      const user = userId ? await userRepository.findByIdWithRoles(userId) : null;
      if (userId && (!user || !user.isActive)) {
        delete req.session.userId;
        req.currentUser = null;
        res.locals.currentUser = null;
        next();
        return;
      }

      req.currentUser = user;
      res.locals.currentUser = req.currentUser;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireLogin(req, res, next) {
  if (!req.currentUser) {
    res.redirect('/login');
    return;
  }
  next();
}
