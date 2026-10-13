package com.example.constructiontracker.controller;

import com.example.constructiontracker.auth.AuthenticationInterceptor;
import com.example.constructiontracker.auth.HeaderIdentityParser;
import com.example.constructiontracker.config.TimeConfig;
import com.example.constructiontracker.config.WebMvcConfig;
import com.example.constructiontracker.domain.ConstructionStage;
import com.example.constructiontracker.domain.UserRole;
import com.example.constructiontracker.exception.GlobalExceptionHandler;
import com.example.constructiontracker.mapper.SummaryMapper;
import com.example.constructiontracker.service.SummaryService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(SummaryController.class)
@Import({SummaryService.class, TimeConfig.class, WebMvcConfig.class, HeaderIdentityParser.class,
        AuthenticationInterceptor.class, GlobalExceptionHandler.class})
class SummaryControllerTests {
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper json;
    @MockitoBean private SummaryMapper mapper;

    @ParameterizedTest
    @EnumSource(UserRole.class)
    void allAuthenticatedRolesReceiveSixZeroStagesAndEmptyArrayWithoutCommunityFiltering(UserRole role) throws Exception {
        var response = mvc.perform(get("/api/summary").param("asOf", "2026-01-20T18:00:00Z")
                        .header("X-User", "summary-reader").header("X-Role", role.name())
                        .header("X-Community", "Unrelated community"))
                .andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.staleHouseIds").isArray()).andExpect(jsonPath("$.staleHouseIds.length()").value(0))
                .andReturn().getResponse();
        var body = json.readTree(response.getContentAsString());
        assertThat(body.size()).isEqualTo(2);
        assertThat(body.path("stageCounts").size()).isEqualTo(6);
        for (var stage : ConstructionStage.values()) {
            assertThat(body.path("stageCounts").has(stage.name())).isTrue();
            assertThat(body.path("stageCounts").path(stage.name()).isIntegralNumber()).isTrue();
            assertThat(body.path("stageCounts").path(stage.name()).asLong()).isZero();
        }
        verify(mapper).stageCounts(LocalDateTime.parse("2026-01-20T18:00:00"), LocalDate.of(2026, 1, 20));
        verify(mapper).staleHouseIds(LocalDateTime.parse("2026-01-20T18:00:00"), LocalDate.of(2026, 1, 20));
        verifyNoMoreInteractions(mapper);
    }

    @Test
    void missingIdentityReturns401BeforeQuery() throws Exception {
        mvc.perform(get("/api/summary")).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        verifyNoInteractions(mapper);
    }

    @Test
    void invalidAsOfReturns400JsonBeforeQuery() throws Exception {
        mvc.perform(get("/api/summary").param("asOf", "invalid")
                        .header("X-User", "summary-reader").header("X-Role", "VIEWER"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        verifyNoInteractions(mapper);
    }
}
