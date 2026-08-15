package com.mprelist.identity.internal;

import java.util.List;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.MethodParameter;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.mprelist.identity.UserRef;

/**
 * What makes {@link UserRef} a parameter a controller can declare, and — because resolving one means the
 * account has to exist — where first login provisions it.
 *
 * <p>Here rather than in a filter that provisions on every authenticated request, which is the other place it
 * could go. A filter would make provisioning literally the first thing that happens to a caller, at the cost
 * of a query on every request including the ones that never look at an account; this way the account is
 * created by the first handler that needs one, which is #26's {@code /api/me} — the call both clients make
 * immediately after signing in. What the two have in common, and what matters, is that neither leaves it to a
 * handler to remember: a route that declares {@code UserRef} cannot be reached without the row existing.
 *
 * <p>A second resolver rather than a second parameter type on {@link CurrentUserFromToken}, because they are
 * not the same operation — this one writes. Keeping them apart is what lets a handler declare
 * {@link com.mprelist.identity.CurrentUser} and touch no database at all.
 */
@Configuration(proxyBeanMethods = false)
class UserRefFromToken implements WebMvcConfigurer, HandlerMethodArgumentResolver {

	UserRefFromToken(AppUsers accounts) {
		this.accounts = accounts;
	}

	@Override
	public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
		resolvers.add(this);
	}

	@Override
	public boolean supportsParameter(MethodParameter parameter) {
		return UserRef.class.equals(parameter.getParameterType());
	}

	@Override
	public UserRef resolveArgument(MethodParameter parameter, ModelAndViewContainer model,
			NativeWebRequest request, WebDataBinderFactory binders) {
		return this.accounts.accountFor(TokenOnThisRequest.orRefuse(parameter).getSubject());
	}

	private final AppUsers accounts;

}
