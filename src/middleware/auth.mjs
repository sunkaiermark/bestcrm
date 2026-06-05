export function attachCurrentUser(userRepository) {
  return async (req, res, next) => {
    try {
      const userId = req.session?.userId;
      req.currentUser = userId ? await userRepository.findByIdWithRoles(userId) : null;
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
