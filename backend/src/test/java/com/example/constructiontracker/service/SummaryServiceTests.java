package com.example.constructiontracker.service;

import com.example.constructiontracker.domain.ConstructionStage;
import com.example.constructiontracker.domain.StageCount;
import com.example.constructiontracker.exception.BusinessException;
import com.example.constructiontracker.mapper.SummaryMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class SummaryServiceTests {
    private SummaryMapper mapper;
    private Clock clock;
    private SummaryService service;

    @BeforeEach
    void setUp() {
        mapper = mock(SummaryMapper.class);
        clock = mock(Clock.class);
        service = new SummaryService(mapper, clock);
    }

    @Test
    void defaultTimeIsCapturedOnceTruncatedToMicrosecondsAndMissingStagesAreZero() {
        when(clock.instant()).thenReturn(Instant.parse("2026-01-16T05:59:59.123456789Z"),
                Instant.parse("2026-01-16T06:00:00Z"));
        when(mapper.stageCounts(any(), any())).thenReturn(List.of(new StageCount(ConstructionStage.FRAMING, 2L)));
        when(mapper.staleHouseIds(any(), any())).thenReturn(List.of(7L, 9L));
        var response = service.summary(null);
        verify(clock, times(1)).instant();
        var utc = LocalDateTime.parse("2026-01-16T05:59:59.123456");
        var date = LocalDate.of(2026, 1, 15);
        verify(mapper).stageCounts(utc, date);
        verify(mapper).staleHouseIds(utc, date);
        assertThat(response.stageCounts()).hasSize(6).containsEntry(ConstructionStage.FRAMING, 2L);
        for (var stage : ConstructionStage.values()) {
            if (stage != ConstructionStage.FRAMING) assertThat(response.stageCounts().get(stage)).isZero();
        }
        assertThat(response.staleHouseIds()).containsExactly(7L, 9L);
    }

    @ParameterizedTest
    @CsvSource({"2026-01-16T05:59:59+00:00,2026-01-15", "2026-01-16T06:00:00Z,2026-01-16",
            "2026-03-16T04:59:59Z,2026-03-15", "2026-03-16T05:00:00Z,2026-03-16"})
    void explicitUtcUsesChicagoWinterAndDaylightSavingMidnight(String asOf, String expectedDate) {
        service.summary(asOf);
        var utc = LocalDateTime.ofInstant(Instant.parse(asOf), java.time.ZoneOffset.UTC);
        verify(mapper).stageCounts(utc, LocalDate.parse(expectedDate));
        verify(mapper).staleHouseIds(utc, LocalDate.parse(expectedDate));
        verifyNoInteractions(clock);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", " ", "invalid", "2026-02-30T12:00:00Z", "2026-01-01T12:00:00",
            "2026-01-01T12:00:00+01:00", "0999-12-31T12:00:00Z", "1000-01-01T00:00:00Z", "+10000-01-01T12:00:00Z"})
    void invalidOrOutOfDatabaseRangeTimesFailBeforeQueries(String asOf) {
        assertThatThrownBy(() -> service.summary(asOf)).isInstanceOfSatisfying(BusinessException.class, error -> {
            assertThat(error.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(error.getCode()).isEqualTo("INVALID_REQUEST");
        });
        verifyNoInteractions(mapper, clock);
    }
}
