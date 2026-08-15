package com.mprelist.identity.internal;

import java.util.List;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.MethodParameter;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.mprelist.identity.CurrentUser;

/**
 * What makes {@link CurrentUser} a parameter a controller in any module can simply declare:
 *
 * <pre>{@code @PostMapping("/api/relist/authorize")
 * AuthorizationResponse authorize(CurrentUser caller, @RequestBody AuthorizeRequest request)}</pre>
 *
 * <p>A resolver rather than {@code @AuthenticationPrincipal}, so that {@code enforcement} and {@code admin}
 * import nothing from Spring Security to find out who is calling — the hexagonal half of ADR-0012, where
 * Keycloak is an adapter this module owns rather than a type in everyone's signatures. It also fails the
 * right way: {@code @AuthenticationPrincipal CurrentUser} on an anonymous request binds {@code null} and the
 * controller runs, where {@link TokenOnThisRequest#orRefuse} refuses.
 *
 * <p>It registers itself rather than being registered by a configuration class of its own, because the
 * registration and the resolver are one decision and splitting them across two files means one can be
 * changed without the other.
 *
 * <p>This one touches no database. {@link UserRefFromToken} beside it is the parameter that does, and the
 * split is the choice a handler makes by which type it declares.
 */
@Configuration(proxyBeanMethods = false)
class CurrentUserFromToken implements WebMvcConfigurer, HandlerMethodArgumentResolver {

	@Override
	public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
		resolvers.add(this);
	}

	@Override
	public boolean supportsParameter(MethodParameter parameter) {
		return CurrentUser.class.equals(parameter.getParameterType());
	}

	@Override
	public CurrentUser resolveArgument(MethodParameter parameter, ModelAndViewContainer model,
			NativeWebRequest request, WebDataBinderFactory binders) {
		return new CurrentUser(TokenOnThisRequest.orRefuse(parameter).getSubject());
	}

}
