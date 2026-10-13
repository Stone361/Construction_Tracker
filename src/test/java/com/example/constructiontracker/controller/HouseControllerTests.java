package com.example.constructiontracker.controller;

import com.example.constructiontracker.auth.AuthenticationInterceptor;
import com.example.constructiontracker.auth.HeaderIdentityParser;
import com.example.constructiontracker.config.TimeConfig;
import com.example.constructiontracker.config.WebMvcConfig;
import com.example.constructiontracker.domain.*;
import com.example.constructiontracker.dto.HouseListQuery;
import com.example.constructiontracker.exception.GlobalExceptionHandler;
import com.example.constructiontracker.mapper.HouseMapper;
import com.example.constructiontracker.service.AuthorizationService;
import com.example.constructiontracker.service.HouseService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Stream;

import static org.hamcrest.Matchers.nullValue;
import static org.hamcrest.Matchers.aMapWithSize;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 真实认证、授权、创建服务及请求校验；只替换数据库 Mapper。 */
@WebMvcTest(HouseController.class)
@Import({WebMvcConfig.class, HeaderIdentityParser.class, AuthenticationInterceptor.class,
        AuthorizationService.class, HouseService.class, TimeConfig.class, GlobalExceptionHandler.class})
class HouseControllerTests {
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper json;
    @MockitoBean private HouseMapper mapper;

    @ParameterizedTest
    @EnumSource(UserRole.class)
    void everyRoleReadsCompleteDetailAcrossCommunitiesWithoutPhotos(UserRole role) throws Exception {
        when(mapper.findById(1L)).thenReturn(house());
        when(mapper.findPhotosByHouseId(1L)).thenReturn(List.of());
        mvc.perform(get("/api/houses/1").header("X-User", "bob").header("X-Role", role.name())
                        .header("X-Community", "South Austin"))
                .andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$", aMapWithSize(16)))
                .andExpect(jsonPath("$.id").value(1)).andExpect(jsonPath("$.permitNo").value("P-1"))
                .andExpect(jsonPath("$.address").value("Original address"))
                .andExpect(jsonPath("$.community").value("North Austin"))
                .andExpect(jsonPath("$.stage").value("LAND_CLEARING"))
                .andExpect(jsonPath("$.coverPhotoId").value(nullValue()))
                .andExpect(jsonPath("$.createdBy").value("alice"))
                .andExpect(jsonPath("$.updatedAt").value("2026-01-01T05:59:59.123456Z"))
                .andExpect(jsonPath("$.photos").isArray()).andExpect(jsonPath("$.photos.length()").value(0));
        verify(mapper).findById(1L);
        verify(mapper).findPhotosByHouseId(1L);
        verifyNoMoreInteractions(mapper);
    }

    @Test
    void detailSerializesPhotoTimesAsUtcWithoutInternalStorageFields() throws Exception {
        var time = LocalDateTime.parse("2026-01-01T05:59:59.123456");
        var photo = new PhotoMetadata(7L, 1L, ConstructionStage.LAND_CLEARING, "UNKNOWN", time, "EXIF",
                LocalDate.of(2025, 12, 31), time, "uploader", "original.jpg", "image/jpeg", 100L,
                null, null, null);
        when(mapper.findById(1L)).thenReturn(house());
        when(mapper.findPhotosByHouseId(1L)).thenReturn(List.of(photo));
        mvc.perform(get("/api/houses/1").header("X-User", "carol").header("X-Role", "VIEWER"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.photos[0].id").value(7))
                .andExpect(jsonPath("$.photos[0].houseId").value(1))
                .andExpect(jsonPath("$.photos[0].locationStatus").value("UNKNOWN"))
                .andExpect(jsonPath("$.photos[0].takenAt").value("2026-01-01T05:59:59.123456Z"))
                .andExpect(jsonPath("$.photos[0].businessDate").value("2025-12-31"))
                .andExpect(jsonPath("$.photos[0].uploadedAt").value("2026-01-01T05:59:59.123456Z"))
                .andExpect(jsonPath("$.photos[0].storageKey").doesNotExist())
                .andExpect(jsonPath("$.photos[0].contentHash").doesNotExist());
    }

    @Test
    void missingDetailReturns404Json() throws Exception {
        mvc.perform(get("/api/houses/999").header("X-User", "carol").header("X-Role", "VIEWER"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        verify(mapper).findById(999L);
        verifyNoMoreInteractions(mapper);
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-1", "abc", "1.5", "9223372036854775808", "1 OR 1=1"})
    void invalidDetailIdReturns400JsonWithoutDatabaseAccess(String id) throws Exception {
        mvc.perform(get("/api/houses/{id}", id).header("X-User", "carol").header("X-Role", "VIEWER"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        verifyNoInteractions(mapper);
    }

    @ParameterizedTest
    @ValueSource(strings = {"1", "abc"})
    void detailWithoutIdentityReturns401BeforeResolvingId(String id) throws Exception {
        mvc.perform(get("/api/houses/{id}", id)).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        verifyNoInteractions(mapper);
    }

    @ParameterizedTest
    @EnumSource(UserRole.class)
    void everyAuthenticatedRoleCanListOtherCommunitiesAndNullCoordinates(UserRole role) throws Exception {
        var row = house();
        var noCoordinates = new House(2L, "P-2", "Address", "Other community", null, null,
                ConstructionStage.LAND_CLEARING, null, HouseSourceType.MANUAL, null, null,
                row.createdAt(), row.createdBusinessDate(), "alice", row.updatedAt());
        when(mapper.findAll(any())).thenReturn(List.of(row, noCoordinates));
        var result = mvc.perform(get("/api/houses").header("X-User", "bob").header("X-Role", role.name())
                        .header("X-Community", "South Austin"))
                .andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].community").value("North Austin"))
                .andExpect(jsonPath("$[1].community").value("Other community"))
                .andExpect(jsonPath("$[1].lat").value(nullValue()))
                .andExpect(jsonPath("$[1].lng").value(nullValue())).andReturn();
        var response = json.readTree(result.getResponse().getContentAsString());
        for (var item : response) {
            assertThat(item.has("coverPhotoUrl")).isTrue();
            assertThat(item.get("coverPhotoUrl").isNull()).isTrue();
            assertThat(item.has("lastPhotoBusinessDate")).isTrue();
            assertThat(item.get("lastPhotoBusinessDate").isNull()).isTrue();
        }
        verify(mapper).findAll(HouseListQuery.parse(null, null));
        verifyNoMoreInteractions(mapper);
    }

    @Test
    void bboxUsesLongitudeLatitudeOrderAndPassesBoundsToSql() throws Exception {
        when(mapper.findAll(any())).thenReturn(List.of(house()));
        mvc.perform(get("/api/houses").header("X-User", "alice").header("X-Role", "ADMIN")
                        .param("bbox", " -98, 29, -96, 31 "))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(1));
        verify(mapper).findAll(HouseListQuery.parse("-98,29,-96,31", null));
    }

    @Test
    void stageWithoutBboxPassesExistingEnumToSql() throws Exception {
        when(mapper.findAll(any())).thenReturn(List.of());
        mvc.perform(get("/api/houses").header("X-User", "carol").header("X-Role", "VIEWER")
                        .param("stage", "FRAMING"))
                .andExpect(status().isOk());
        verify(mapper).findAll(HouseListQuery.parse(null, "FRAMING"));
    }

    @Test
    void combinesBboxAndStage() throws Exception {
        when(mapper.findAll(any())).thenReturn(List.of());
        mvc.perform(get("/api/houses").header("X-User", "carol").header("X-Role", "VIEWER")
                        .param("bbox", "-98,29,-96,31").param("stage", "FOUNDATION"))
                .andExpect(status().isOk());
        verify(mapper).findAll(HouseListQuery.parse("-98,29,-96,31", "FOUNDATION"));
    }

    @Test
    void originalCoordinateParametersQueryTheSameBounds() throws Exception {
        when(mapper.findAll(any())).thenReturn(List.of(house()));
        mvc.perform(get("/api/houses").header("X-User", "carol").header("X-Role", "VIEWER")
                        .param("minLat", "29").param("maxLat", "31")
                        .param("minLng", "-98").param("maxLng", "-96"))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(1));
        verify(mapper).findAll(HouseListQuery.parse("-98,29,-96,31", null));
        verifyNoMoreInteractions(mapper);
    }

    @Test
    void originalCoordinateParametersCombineWithStage() throws Exception {
        when(mapper.findAll(any())).thenReturn(List.of());
        mvc.perform(get("/api/houses").header("X-User", "bob").header("X-Role", "SITE_MANAGER")
                        .header("X-Community", "Other community").param("minLat", "29").param("maxLat", "31")
                        .param("minLng", "-98").param("maxLng", "-96").param("stage", "FRAMING"))
                .andExpect(status().isOk()).andExpect(content().json("[]"));
        verify(mapper).findAll(HouseListQuery.parse("-98,29,-96,31", "FRAMING"));
    }

    @ParameterizedTest
    @MethodSource("singleCoordinateBounds")
    void originalBoundsCanBeProvidedIndividually(String parameter, String value, String expectedBbox) throws Exception {
        when(mapper.findAll(any())).thenReturn(List.of());
        mvc.perform(get("/api/houses").header("X-User", "carol").header("X-Role", "VIEWER")
                        .param(parameter, value))
                .andExpect(status().isOk());
        verify(mapper).findAll(HouseListQuery.parse(expectedBbox, null));
    }

    static Stream<Arguments> singleCoordinateBounds() {
        return Stream.of(Arguments.of("minLat", "29", "-180,29,180,90"),
                Arguments.of("maxLat", "31", "-180,-90,180,31"),
                Arguments.of("minLng", "-98", "-98,-90,180,90"),
                Arguments.of("maxLng", "-96", "-180,-90,-96,90"));
    }

    @Test
    void mixingBboxAndOriginalBoundsReturns400() throws Exception {
        mvc.perform(get("/api/houses").header("X-User", "alice").header("X-Role", "ADMIN")
                        .param("bbox", "-98,29,-96,31").param("minLat", "29"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        verifyNoInteractions(mapper);
    }

    @ParameterizedTest
    @MethodSource("invalidOriginalBounds")
    void invalidOriginalBoundsReturn400BeforeQuerying(Map<String, String> bounds) throws Exception {
        var request = get("/api/houses").header("X-User", "alice").header("X-Role", "ADMIN");
        bounds.forEach((key, value) -> request.param(key, value));
        mvc.perform(request).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        verifyNoInteractions(mapper);
    }

    static Stream<Map<String, String>> invalidOriginalBounds() {
        return Stream.of(Map.of("minLat", ""), Map.of("minLng", "NaN"), Map.of("maxLat", "91"),
                Map.of("maxLng", "181"), Map.of("minLat", "31", "maxLat", "29"),
                Map.of("minLng", "-96", "maxLng", "-98"), Map.of("minLng", "-98,29"));
    }

    @Test
    void noMatchesReturnsEmptyJsonArray() throws Exception {
        when(mapper.findAll(any())).thenReturn(List.of());
        mvc.perform(get("/api/houses").header("X-User", "carol").header("X-Role", "VIEWER"))
                .andExpect(status().isOk()).andExpect(content().json("[]"));
    }

    @Test
    void listWithoutIdentityReturns401EvenWithInvalidQuery() throws Exception {
        mvc.perform(get("/api/houses").param("bbox", "invalid"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        verifyNoInteractions(mapper);
    }

    @Test
    void listWithInvalidRoleReturns401() throws Exception {
        mvc.perform(get("/api/houses").header("X-User", "alice").header("X-Role", "OWNER"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        verifyNoInteractions(mapper);
    }

    @ParameterizedTest
    @MethodSource("invalidListQueries")
    void invalidListParametersReturn400JsonBeforeQuerying(String bbox, String stage) throws Exception {
        var request = get("/api/houses").header("X-User", "alice").header("X-Role", "ADMIN");
        if (bbox != null) request.param("bbox", bbox);
        if (stage != null) request.param("stage", stage);
        mvc.perform(request).andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        verifyNoInteractions(mapper);
    }

    static Stream<Arguments> invalidListQueries() {
        var bbox = Stream.of("", " ", "-98,29,-96", "-98,29,-96,31,32", "-98,, -96,31", "-98,29,-96,",
                "NaN,29,-96,31", "-98,29,Infinity,31", "1e2147483647,29,-96,31",
                "-181,29,-96,31", "-98,29,181,31", "-98,-91,-96,31", "-98,29,-96,91",
                "-96,29,-98,31", "-98,31,-96,29", "-98 OR 1=1,29,-96,31", "0".repeat(33) + ",29,0,31")
                .map(value -> Arguments.of(value, null));
        var stage = Stream.of("", " ", "framing", "UNKNOWN", "FRAMING OR 1=1")
                .map(value -> Arguments.of(null, value));
        return Stream.concat(bbox, stage);
    }

    @Test
    void adminCreatesHouseWith201AndUtcJson() throws Exception {
        when(mapper.findByPermitNo("P-1")).thenReturn(null, house());
        mvc.perform(post("/api/houses").header("X-User", "alice").header("X-Role", "ADMIN")
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(validBody())))
                .andExpect(status().isCreated()).andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.id").value(1)).andExpect(jsonPath("$.permitNo").value("P-1"))
                .andExpect(jsonPath("$.stage").value("LAND_CLEARING"))
                .andExpect(jsonPath("$.createdAt").value("2026-01-01T05:59:59.123456Z"))
                .andExpect(jsonPath("$.createdBusinessDate").value("2025-12-31"));
        verify(mapper).insert(any());
    }

    @Test
    void duplicateReturns200WithOriginalRecord() throws Exception {
        when(mapper.findByPermitNo("P-1")).thenReturn(house());
        var body = validBody();
        body.put("address", "Replacement address");
        mvc.perform(post("/api/houses").header("X-User", "alice").header("X-Role", "ADMIN")
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(1))
                .andExpect(jsonPath("$.address").value("Original address"));
        verify(mapper, never()).insert(any());
    }

    @ParameterizedTest
    @EnumSource(value = UserRole.class, names = {"SITE_MANAGER", "VIEWER"})
    void nonAdminsReceive403WithoutDatabaseAccess(UserRole role) throws Exception {
        mvc.perform(post("/api/houses").header("X-User", "bob").header("X-Role", role.name())
                        .header("X-Community", "North Austin").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(validBody())))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.message").value("没有操作权限"));
        verifyNoInteractions(mapper);
    }

    @Test
    void missingHeadersStillReturns401() throws Exception {
        mvc.perform(post("/api/houses").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(validBody())))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        verifyNoInteractions(mapper);
    }

    @Test
    void invalidRoleStillReturns401() throws Exception {
        mvc.perform(post("/api/houses").header("X-User", "alice").header("X-Role", "OWNER")
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(validBody())))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(mapper);
    }

    @ParameterizedTest
    @MethodSource("invalidBodies")
    void invalidInputReturns400WithoutDatabaseAccess(Map<String, Object> body) throws Exception {
        mvc.perform(post("/api/houses").header("X-User", "alice").header("X-Role", "ADMIN")
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        verifyNoInteractions(mapper);
    }

    @Test
    void absentCoordinatesAreAcceptedAsAPair() throws Exception {
        House noCoordinates = new House(1L, "P-1", "Original address", "North Austin", null, null,
                ConstructionStage.LAND_CLEARING, null, HouseSourceType.MANUAL, null, null,
                house().createdAt(), house().createdBusinessDate(), "alice", house().updatedAt());
        when(mapper.findByPermitNo("P-1")).thenReturn(null, noCoordinates);
        var body = validBody();
        body.remove("lat"); body.remove("lng");
        mvc.perform(post("/api/houses").header("X-User", "alice").header("X-Role", "ADMIN")
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.lat").value(nullValue()))
                .andExpect(jsonPath("$.lng").value(nullValue()));
    }

    @Test
    void clientCannotSetInitialStageOrCreator() throws Exception {
        when(mapper.findByPermitNo("P-1")).thenReturn(null, house());
        var body = validBody();
        body.put("stage", "CO_READY"); body.put("createdBy", "forged");
        mvc.perform(post("/api/houses").header("X-User", "alice").header("X-Role", "ADMIN")
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)))
                .andExpect(status().isCreated());
        verify(mapper).insert(argThat(h -> h.stage() == ConstructionStage.LAND_CLEARING && h.createdBy().equals("alice")));
    }

    @Test
    void malformedJsonReturnsStable400() throws Exception {
        mvc.perform(post("/api/houses").header("X-User", "alice").header("X-Role", "ADMIN")
                        .contentType(MediaType.APPLICATION_JSON).content("{broken"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        verifyNoInteractions(mapper);
    }

    static Stream<Map<String, Object>> invalidBodies() {
        return Stream.of(
                changed("permitNo", null), changed("permitNo", " \t "), changed("permitNo", "p".repeat(129)),
                changed("address", " "), changed("address", "a".repeat(513)),
                changed("community", " "), changed("community", "c".repeat(129)),
                changed("lat", null), changed("lng", null), changed("lat", 90.0000001), changed("lng", -180.0000001),
                changed("lat", new BigDecimal("30.12345678")),
                changed("sourceUrl", "https://example.org/permits/1"),
                changed("sourceFetchedAt", "2026-01-01T00:00:00Z"),
                sourced("file:///etc/passwd"), sourced("https://user:secret@example.org/permit/1"), sourced(" "),
                sourceTime("0001-01-01T00:00:00Z"), sourceTime("+10000-01-01T00:00:00Z"));
    }

    private static Map<String, Object> changed(String key, Object value) {
        var body = validBody(); body.put(key, value); return body;
    }

    private static Map<String, Object> sourced(String url) {
        var body = changed("sourceUrl", url);
        body.put("sourceFetchedAt", "2026-01-01T00:00:00Z"); return body;
    }

    private static Map<String, Object> sourceTime(String time) {
        var body = sourced("https://example.org/permits/1");
        body.put("sourceFetchedAt", time); return body;
    }

    private static Map<String, Object> validBody() {
        return new LinkedHashMap<>(Map.of("permitNo", " P-1 ", "address", "Test address",
                "community", "North Austin", "lat", 30.1234567, "lng", -97.1234567));
    }

    private static House house() {
        LocalDateTime time = LocalDateTime.parse("2026-01-01T05:59:59.123456");
        return new House(1L, "P-1", "Original address", "North Austin", new BigDecimal("30.1234567"),
                new BigDecimal("-97.1234567"), ConstructionStage.LAND_CLEARING, null,
                HouseSourceType.MANUAL, null, null, time, LocalDate.of(2025, 12, 31), "alice", time);
    }
}
